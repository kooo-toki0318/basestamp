import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  issueSponsorGrant,
  type SponsorGrantRecord,
  type SponsorGrantRepository
} from "../worker/sponsor";

const walletA = "0x1111111111111111111111111111111111111111" as Address;
const walletB = "0x2222222222222222222222222222222222222222" as Address;
const idempotencyKey = "123e4567-e89b-42d3-a456-426614174000";
const config = {
  allowedHostnames: new Set(["basestamp-web.ndun000.workers.dev"]),
  policyVersion: 1,
  sponsorIdHmacSecret: "i".repeat(32),
  turnstileSecret: "t".repeat(32)
};

function createMemoryRepository(): SponsorGrantRepository & {
  records: Map<string, SponsorGrantRecord>;
} {
  const records = new Map<string, SponsorGrantRecord>();
  return {
    records,
    findByIdempotencyKeyHash(idempotencyKeyHash) {
      return Promise.resolve(records.get(idempotencyKeyHash) ?? null);
    },
    insertGrant(record) {
      if (records.has(record.idempotencyKeyHash)) {
        return Promise.reject(new Error("unique constraint"));
      }
      records.set(record.idempotencyKeyHash, record);
      return Promise.resolve();
    }
  };
}

describe("Sponsor grants", () => {
  it("returns the same wallet-bound grant for an idempotent retry without repeating Turnstile", async () => {
    const repository = createMemoryRepository();
    let verifications = 0;
    const arguments_ = {
      action: "sponsor_stamp",
      chainId: 84532 as const,
      config,
      idempotencyKey,
      now: 1_786_406_400,
      repository,
      verifyHuman: () => {
        verifications += 1;
        return Promise.resolve();
      },
      walletAddress: walletA
    };

    const first = await issueSponsorGrant(arguments_);
    const retried = await issueSponsorGrant(arguments_);
    expect(retried).toEqual(first);
    expect(first.grantToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(repository.records.size).toBe(1);
    expect(verifications).toBe(1);
  });

  it("rejects reuse of an idempotency key by a different wallet", async () => {
    const repository = createMemoryRepository();
    const baseArguments = {
      action: "sponsor_stamp",
      chainId: 84532 as const,
      config,
      idempotencyKey,
      now: 1_786_406_400,
      repository,
      verifyHuman: () => Promise.resolve()
    };
    await issueSponsorGrant({ ...baseArguments, walletAddress: walletA });
    await expect(
      issueSponsorGrant({ ...baseArguments, walletAddress: walletB })
    ).rejects.toMatchObject({ code: "sponsor_request_conflict", status: 403 });
  });

  it("does not persist a grant when Turnstile fails", async () => {
    const repository = createMemoryRepository();
    await expect(
      issueSponsorGrant({
        action: "sponsor_stamp",
        chainId: 84532,
        config,
        idempotencyKey,
        now: 1_786_406_400,
        repository,
        verifyHuman: () => Promise.reject(new Error("rejected")),
        walletAddress: walletA
      })
    ).rejects.toThrow("rejected");
    expect(repository.records.size).toBe(0);
  });
});
