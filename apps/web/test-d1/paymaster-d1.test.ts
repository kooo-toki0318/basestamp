import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createD1SponsorProxyRepository,
  utcMonthStart
} from "../worker/paymaster";

const NOW = 1_786_406_400;
const DAY_START = Math.floor(NOW / 86_400) * 86_400;
const MONTH_START = utcMonthStart(NOW);
const WALLET_KEY = "a".repeat(64);
const PAYMASTER_AND_DATA =
  "0x1111111111111111111111111111111111111111";

type ClaimFixture = {
  claimId: string;
  fingerprintHash: string;
  grantTokenHash: string;
  ipBucketKey: string;
  walletKey: string;
};

type ClaimStateRow = {
  claim_id: string;
  request_fingerprint_hash: string | null;
  request_ip_bucket_key: string | null;
  reserved_wallet_key: string | null;
  status: string;
};

type StatusCountRow = {
  count: number;
  status: string;
};

function value64(value: number): string {
  return value.toString(16).padStart(64, "0");
}

function createFixtures(): ClaimFixture[] {
  return Array.from({ length: 4 }, (_, index) => ({
    claimId: `concurrent-claim-${String(index + 1)}`,
    fingerprintHash: value64(100 + index),
    grantTokenHash: value64(200 + index),
    ipBucketKey: value64(300 + index),
    walletKey: WALLET_KEY
  }));
}

function createLimitFixtures(arguments_: {
  count: number;
  prefix: string;
  seed: number;
  sharedIpBucketKey?: string;
}): ClaimFixture[] {
  const { count, prefix, seed, sharedIpBucketKey } = arguments_;
  return Array.from({ length: count }, (_, index) => ({
    claimId: `${prefix}-${String(index + 1)}`,
    fingerprintHash: value64(seed + 100 + index),
    grantTokenHash: value64(seed + 200 + index),
    ipBucketKey: sharedIpBucketKey ?? value64(seed + 300 + index),
    walletKey: value64(seed + index)
  }));
}

async function seedClaim(fixture: ClaimFixture, now = NOW): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO sponsor_claims " +
      "(claim_id, chain_id, action, status, policy_version, " +
      "grant_wallet_key, grant_token_hash, grant_expires_at, created_at) " +
      "VALUES (?, 84532, 'sponsor_stamp', 'grant_issued', 2, ?, ?, ?, ?)"
  )
    .bind(
      fixture.claimId,
      fixture.walletKey,
      fixture.grantTokenHash,
      now + 300,
      now
    )
    .run();
}

function reserveClaim(
  repository: ReturnType<typeof createD1SponsorProxyRepository>,
  fixture: ClaimFixture,
  period: { dayStart: number; monthStart: number; now: number }
): Promise<void> {
  return repository.reserve({
    claimId: fixture.claimId,
    dayStart: period.dayStart,
    fingerprintHash: fixture.fingerprintHash,
    grantTokenHash: fixture.grantTokenHash,
    grantWalletKey: fixture.walletKey,
    ipBucketKey: fixture.ipBucketKey,
    method: "pm_getPaymasterData",
    monthStart: period.monthStart,
    now: period.now,
    policyVersion: 2,
    walletQuotaBypassed: false
  });
}

async function readCounter(counterKey: string): Promise<number> {
  return (
    (await env.DB.prepare(
      "SELECT count FROM quota_counters WHERE counter_key = ?"
    )
      .bind(counterKey)
      .first<number>("count")) ?? 0
  );
}

async function readIpReservationCount(): Promise<number> {
  return (
    (await env.DB.prepare(
      "SELECT COALESCE(SUM(count), 0) AS count FROM rate_limit_buckets"
    ).first<number>("count")) ?? 0
  );
}

async function readIpBucketCount(ipBucketKey: string): Promise<number> {
  return (
    (await env.DB.prepare(
      "SELECT count FROM rate_limit_buckets WHERE bucket_key = ?"
    )
      .bind(ipBucketKey)
      .first<number>("count")) ?? 0
  );
}

async function readAssertionCount(): Promise<number> {
  return (
    (await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM sponsor_reservation_assertions"
    ).first<number>("count")) ?? 0
  );
}

async function readClaimStates(prefix: string): Promise<ClaimStateRow[]> {
  return (await env.DB.prepare(
    "SELECT claim_id, request_fingerprint_hash, request_ip_bucket_key, " +
      "reserved_wallet_key, status FROM sponsor_claims " +
      "WHERE claim_id LIKE ? ORDER BY claim_id"
  )
    .bind(`${prefix}-%`)
    .all<ClaimStateRow>()).results;
}

function walletCounterKey(monthStart: number, walletKey: string): string {
  return `sponsor:wallet:month:${String(monthStart)}:${walletKey}`;
}

function globalCounterKey(dayStart: number): string {
  return `sponsor:global:day:${String(dayStart)}`;
}

function expectQuotaRejection(result: PromiseRejectedResult | undefined): void {
  expect(result?.reason).toMatchObject({
    code: "sponsor_quota_exceeded",
    status: 403
  });
}

describe("Paymaster D1 release gate", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  it("admits at most three concurrent wallet-month reservations and retains only final sponsorships", async () => {
    const repository = createD1SponsorProxyRepository(env.DB);
    const fixtures = createFixtures();
    await Promise.all(fixtures.map((fixture) => seedClaim(fixture)));

    const period = { dayStart: DAY_START, monthStart: MONTH_START, now: NOW };
    const reserve = (fixture: ClaimFixture) =>
      reserveClaim(repository, fixture, period);

    const results = await Promise.allSettled(fixtures.map(reserve));
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<void> =>
        result.status === "fulfilled"
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(1);
    expectQuotaRejection(rejected[0]);

    const walletCounter = walletCounterKey(MONTH_START, WALLET_KEY);
    const globalCounter = globalCounterKey(DAY_START);
    expect(await readCounter(walletCounter)).toBe(3);
    expect(await readCounter(globalCounter)).toBe(3);
    expect(await readIpReservationCount()).toBe(3);
    expect(await readAssertionCount()).toBe(0);

    const claims = (await env.DB.prepare(
      "SELECT claim_id, request_fingerprint_hash, request_ip_bucket_key, " +
        "reserved_wallet_key, status FROM sponsor_claims ORDER BY claim_id"
    ).all<ClaimStateRow>()).results;
    const requested = claims.filter((claim) => claim.status === "requested");
    const notReserved = claims.find((claim) => claim.status === "grant_issued");
    const sponsored = requested.at(0);
    const stubbed = requested.at(1);
    const released = requested.at(2);
    if (!sponsored || !stubbed || !released || !notReserved) {
      throw new Error("Unexpected sponsor reservation states.");
    }

    const fixtureFor = (claimId: string): ClaimFixture => {
      const fixture = fixtures.find((candidate) => candidate.claimId === claimId);
      if (!fixture) throw new Error("Missing claim fixture.");
      return fixture;
    };
    await repository.completeSponsored({
      claimId: sponsored.claim_id,
      fingerprintHash: fixtureFor(sponsored.claim_id).fingerprintHash,
      now: NOW,
      providerReferenceHash: value64(400),
      responseJson: JSON.stringify({ paymasterAndData: PAYMASTER_AND_DATA })
    });
    await repository.completeStub({
      claimId: stubbed.claim_id,
      fingerprintHash: fixtureFor(stubbed.claim_id).fingerprintHash,
      responseJson: JSON.stringify({
        isFinal: false,
        paymasterAndData: PAYMASTER_AND_DATA
      })
    });
    await repository.release(released.claim_id);

    expect(await readCounter(walletCounter)).toBe(1);
    expect(await readCounter(globalCounter)).toBe(1);
    expect(await readIpReservationCount()).toBe(1);

    await reserve(fixtureFor(notReserved.claim_id));
    expect(await readCounter(walletCounter)).toBe(2);
    await repository.deny(notReserved.claim_id, NOW);
    expect(await readCounter(walletCounter)).toBe(1);
    expect(await readCounter(globalCounter)).toBe(1);
    expect(await readIpReservationCount()).toBe(1);

    const statuses = (await env.DB.prepare(
      "SELECT status, COUNT(*) AS count FROM sponsor_claims " +
        "GROUP BY status ORDER BY status"
    ).all<StatusCountRow>()).results;
    expect(statuses).toEqual([
      { count: 1, status: "denied" },
      { count: 2, status: "grant_issued" },
      { count: 1, status: "sponsored" }
    ]);
  });

  it("atomically caps one IP bucket at three distinct wallets", async () => {
    const repository = createD1SponsorProxyRepository(env.DB);
    const now = NOW + 40 * 86_400;
    const period = {
      dayStart: Math.floor(now / 86_400) * 86_400,
      monthStart: utcMonthStart(now),
      now
    };
    const sharedIpBucketKey = value64(1_300);
    const fixtures = createLimitFixtures({
      count: 4,
      prefix: "ip-limit",
      seed: 1_000,
      sharedIpBucketKey
    });
    await Promise.all(fixtures.map((fixture) => seedClaim(fixture, now)));

    const results = await Promise.allSettled(
      fixtures.map((fixture) => reserveClaim(repository, fixture, period))
    );
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    expect(fulfilled).toHaveLength(3);
    expect(rejected).toHaveLength(1);
    expectQuotaRejection(rejected[0]);

    const claims = await readClaimStates("ip-limit");
    const requested = claims.filter((claim) => claim.status === "requested");
    const notReserved = claims.filter(
      (claim) => claim.status === "grant_issued"
    );
    expect(requested).toHaveLength(3);
    expect(notReserved).toHaveLength(1);
    expect(notReserved[0]).toMatchObject({
      request_fingerprint_hash: null,
      request_ip_bucket_key: null,
      reserved_wallet_key: null
    });

    const walletCounts = await Promise.all(
      fixtures.map((fixture) =>
        readCounter(walletCounterKey(period.monthStart, fixture.walletKey))
      )
    );
    expect(walletCounts.reduce((sum, count) => sum + count, 0)).toBe(3);
    expect(walletCounts.filter((count) => count === 1)).toHaveLength(3);
    expect(await readIpBucketCount(sharedIpBucketKey)).toBe(3);
    expect(await readCounter(globalCounterKey(period.dayStart))).toBe(3);
    expect(await readAssertionCount()).toBe(0);
  });

  it("atomically caps the global day at ten distinct wallets and IPs", async () => {
    const repository = createD1SponsorProxyRepository(env.DB);
    const now = NOW + 80 * 86_400;
    const period = {
      dayStart: Math.floor(now / 86_400) * 86_400,
      monthStart: utcMonthStart(now),
      now
    };
    const fixtures = createLimitFixtures({
      count: 11,
      prefix: "global-limit",
      seed: 2_000
    });
    await Promise.all(fixtures.map((fixture) => seedClaim(fixture, now)));

    const results = await Promise.allSettled(
      fixtures.map((fixture) => reserveClaim(repository, fixture, period))
    );
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    expect(fulfilled).toHaveLength(10);
    expect(rejected).toHaveLength(1);
    expectQuotaRejection(rejected[0]);

    const claims = await readClaimStates("global-limit");
    const requested = claims.filter((claim) => claim.status === "requested");
    const notReserved = claims.filter(
      (claim) => claim.status === "grant_issued"
    );
    expect(requested).toHaveLength(10);
    expect(notReserved).toHaveLength(1);
    expect(notReserved[0]).toMatchObject({
      request_fingerprint_hash: null,
      request_ip_bucket_key: null,
      reserved_wallet_key: null
    });

    const walletCounts = await Promise.all(
      fixtures.map((fixture) =>
        readCounter(walletCounterKey(period.monthStart, fixture.walletKey))
      )
    );
    const ipCounts = await Promise.all(
      fixtures.map((fixture) => readIpBucketCount(fixture.ipBucketKey))
    );
    expect(walletCounts.reduce((sum, count) => sum + count, 0)).toBe(10);
    expect(walletCounts.filter((count) => count === 1)).toHaveLength(10);
    expect(ipCounts.reduce((sum, count) => sum + count, 0)).toBe(10);
    expect(ipCounts.filter((count) => count === 1)).toHaveLength(10);
    expect(await readCounter(globalCounterKey(period.dayStart))).toBe(10);
    expect(await readAssertionCount()).toBe(0);
  });
});
