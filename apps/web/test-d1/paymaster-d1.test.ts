import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createD1SponsorProxyRepository } from "../worker/paymaster";

const NOW = 1_786_406_400;
const WALLET_KEY = "a".repeat(64);
const PAYMASTER_AND_DATA =
  "0x1111111111111111111111111111111111111111";

type ClaimFixture = {
  claimId: string;
  fingerprintHash: string;
  grantTokenHash: string;
  walletKey: string;
};

type ClaimStateRow = {
  request_fingerprint_hash: string | null;
  request_ip_bucket_key: string | null;
  request_method: string | null;
  reserved_wallet_key: string | null;
  status: string;
};

function value64(value: number): string {
  return value.toString(16).padStart(64, "0");
}

function fixture(id: string, seed: number): ClaimFixture {
  return {
    claimId: id,
    fingerprintHash: value64(seed + 100),
    grantTokenHash: value64(seed + 200),
    walletKey: WALLET_KEY
  };
}

async function seedClaim(
  claim: ClaimFixture,
  now = NOW
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO sponsor_claims " +
      "(claim_id, chain_id, action, status, policy_version, " +
      "grant_wallet_key, grant_token_hash, grant_expires_at, created_at) " +
      "VALUES (?, 84532, 'sponsor_stamp', 'grant_issued', 2, ?, ?, ?, ?)"
  )
    .bind(
      claim.claimId,
      claim.walletKey,
      claim.grantTokenHash,
      now + 300,
      now
    )
    .run();
}

function reserve(
  repository: ReturnType<typeof createD1SponsorProxyRepository>,
  claim: ClaimFixture,
  method: "pm_getPaymasterData" | "pm_getPaymasterStubData" =
    "pm_getPaymasterData"
): Promise<boolean> {
  return repository.reserve({
    claimId: claim.claimId,
    fingerprintHash: claim.fingerprintHash,
    grantTokenHash: claim.grantTokenHash,
    grantWalletKey: claim.walletKey,
    method,
    now: NOW,
    policyVersion: 2,
  });
}

async function readClaim(claimId: string): Promise<ClaimStateRow> {
  const row = await env.DB.prepare(
    "SELECT status, reserved_wallet_key, request_ip_bucket_key, " +
      "request_method, request_fingerprint_hash FROM sponsor_claims " +
      "WHERE claim_id = ?"
  )
    .bind(claimId)
    .first<ClaimStateRow>();

  if (row === null) throw new Error("Missing claim.");
  return row;
}

async function runtimeQuotaRows(): Promise<number> {
  const quota =
    (await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM quota_counters " +
        "WHERE counter_key LIKE 'sponsor:%'"
    ).first<number>("count")) ?? 0;
  const rate =
    (await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM rate_limit_buckets"
    ).first<number>("count")) ?? 0;
  return quota + rate;
}

describe("Paymaster D1 claim reservation", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  it("uses the claim as a concurrency lock without counting Paymaster RPCs as transactions", async () => {
    const repository = createD1SponsorProxyRepository(env.DB);
    const claim = fixture("claim-lock", 1_000);
    await seedClaim(claim);

    const attempts = await Promise.all(
      Array.from({ length: 5 }, () => reserve(repository, claim))
    );

    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect(attempts.filter((value) => !value)).toHaveLength(4);
    expect(await readClaim(claim.claimId)).toMatchObject({
      request_fingerprint_hash: claim.fingerprintHash,
      request_ip_bucket_key: null,
      request_method: "pm_getPaymasterData",
      status: "requested"
    });
    expect(await runtimeQuotaRows()).toBe(0);
  });

  it("returns a stub reservation to grant_issued without touching legacy quota tables", async () => {
    const repository = createD1SponsorProxyRepository(env.DB);
    const claim = fixture("claim-stub", 2_000);
    await seedClaim(claim);

    expect(
      await reserve(repository, claim, "pm_getPaymasterStubData")
    ).toBe(true);

    await repository.completeStub({
      claimId: claim.claimId,
      fingerprintHash: claim.fingerprintHash,
      responseJson: JSON.stringify({
        isFinal: false,
        paymasterAndData: PAYMASTER_AND_DATA
      })
    });

    expect(await readClaim(claim.claimId)).toEqual({
      request_fingerprint_hash: null,
      request_ip_bucket_key: null,
      request_method: null,
      reserved_wallet_key: null,
      status: "grant_issued"
    });
    expect(await runtimeQuotaRows()).toBe(0);
  });

  it("marks final Paymaster data sponsored without incrementing transaction counters", async () => {
    const repository = createD1SponsorProxyRepository(env.DB);
    const claim = fixture("claim-final", 3_000);
    await seedClaim(claim);

    expect(await reserve(repository, claim)).toBe(true);

    await repository.completeSponsored({
      claimId: claim.claimId,
      fingerprintHash: claim.fingerprintHash,
      now: NOW,
      providerReferenceHash: value64(9_000),
      responseJson: JSON.stringify({
        paymasterAndData: PAYMASTER_AND_DATA
      })
    });

    expect(await readClaim(claim.claimId)).toMatchObject({
      status: "sponsored"
    });
    expect(await runtimeQuotaRows()).toBe(0);
  });

  it("serializes sponsored-claim retries and restores sponsored on release", async () => {
    const repository = createD1SponsorProxyRepository(env.DB);
    const claim = fixture("claim-sponsored-retry", 3_500);
    await seedClaim(claim);
    await env.DB.prepare(
      "UPDATE sponsor_claims SET status = 'sponsored', sponsored_at = ?, " +
        "terminal_at = ? WHERE claim_id = ?"
    ).bind(NOW - 1, NOW - 1, claim.claimId).run();

    const attempts = await Promise.all(
      Array.from({ length: 4 }, () => reserve(repository, claim))
    );
    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect(attempts.filter((value) => !value)).toHaveLength(3);

    await repository.release(claim.claimId);

    expect(await readClaim(claim.claimId)).toEqual({
      request_fingerprint_hash: null,
      request_ip_bucket_key: null,
      request_method: null,
      reserved_wallet_key: null,
      status: "sponsored"
    });
    expect(await runtimeQuotaRows()).toBe(0);
  });

  it("releases a failed provider request without incrementing transaction counters", async () => {
    const repository = createD1SponsorProxyRepository(env.DB);
    const claim = fixture("claim-release", 4_000);
    await seedClaim(claim);

    expect(await reserve(repository, claim)).toBe(true);
    await repository.release(claim.claimId);

    expect(await readClaim(claim.claimId)).toEqual({
      request_fingerprint_hash: null,
      request_ip_bucket_key: null,
      request_method: null,
      reserved_wallet_key: null,
      status: "grant_issued"
    });
    expect(await runtimeQuotaRows()).toBe(0);
  });
});
