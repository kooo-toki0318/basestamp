import { describe, expect, it } from "vitest";
import { validateSiweFields } from "../worker/auth-policy";

const now = new Date("2026-08-03T12:00:00.000Z");
const policy = {
  domain: "localhost:5173",
  origin: "http://localhost:5173",
  chainId: 84532,
  now,
  maxClockSkewMs: 300_000,
  maxLifetimeMs: 600_000
};

function validFields() {
  return {
    domain: policy.domain,
    uri: policy.origin,
    version: "1",
    chainId: policy.chainId,
    nonce: "12345678",
    issuedAt: new Date(now.getTime() - 1_000),
    expirationTime: new Date(now.getTime() + 300_000)
  };
}

describe("SIWE policy", () => {
  it("accepts the fixed domain, URI, chain, nonce, and time window", () => {
    expect(validateSiweFields(validFields(), policy)).toBeNull();
  });

  it.each([
    ["domain", { domain: "attacker.example" }],
    ["uri", { uri: "https://attacker.example" }],
    ["chain_id", { chainId: 8453 }],
    ["unsupported_extension", { resources: ["https://attacker.example"] }]
  ])("rejects %s confusion", (reason, override) => {
    expect(validateSiweFields({ ...validFields(), ...override }, policy)).toBe(
      reason
    );
  });

  it("requires expiration and rejects a future issued-at", () => {
    expect(
      validateSiweFields(
        {
          ...validFields(),
          issuedAt: new Date(now.getTime() + 301_000)
        },
        policy
      )
    ).toBe("issued_at");
    expect(
      validateSiweFields(
        { ...validFields(), expirationTime: undefined },
        policy
      )
    ).toBe("expiration_time");
  });
});
