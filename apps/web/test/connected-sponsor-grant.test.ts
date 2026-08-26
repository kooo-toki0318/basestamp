import { describe, expect, it, vi } from "vitest";
import { handleConnectedSponsorGrant } from "../worker/connected-sponsor-grant";
import type { Bindings } from "../worker/types";

const sponsorEnv = {
  SIWE_ALLOWED_ORIGIN: "http://localhost:5173",
  SPONSOR_ENABLED: "true",
  SPONSOR_POLICY_VERSION: "1",
  SPONSOR_ID_HMAC_SECRET: "i".repeat(32),
  TURNSTILE_ALLOWED_HOSTNAMES: "basestamp-web.ndun000.workers.dev",
  TURNSTILE_SECRET_KEY: "t".repeat(32)
} as Bindings;

function sponsorRequest(body: Record<string, unknown>, origin = "http://localhost:5173") {
  return new Request("http://localhost/api/sponsor/connected-grant", {
    method: "POST",
    headers: {
      "CF-Connecting-IP": "203.0.113.10",
      "Content-Type": "application/json",
      Origin: origin
    },
    body: JSON.stringify(body)
  });
}

const validBody = {
  chainId: 8453,
  idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
  turnstileToken: "valid-turnstile-token",
  walletAddress: "0x1111111111111111111111111111111111111111"
};

describe("connected wallet sponsor grants", () => {
  it("binds a Turnstile-verified grant to the supplied wallet and chain", async () => {
    const verifyTurnstile = vi.fn(() => Promise.resolve());
    const response = await handleConnectedSponsorGrant(
      sponsorRequest(validBody),
      sponsorEnv,
      {
        verifyTurnstile,
        issueGrant: async (_env, arguments_) => {
          expect(arguments_.chainId).toBe(8453);
          expect(arguments_.walletAddress).toBe(
            "0x1111111111111111111111111111111111111111"
          );
          await arguments_.verifyHuman();
          return {
            claimId: "65e41858-cd5e-4c75-b9e4-9a772d748949",
            expiresAt: "2026-08-27T12:00:00Z",
            grantToken: "g".repeat(43)
          };
        }
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      claimId: "65e41858-cd5e-4c75-b9e4-9a772d748949",
      expiresAt: "2026-08-27T12:00:00Z",
      grantToken: "g".repeat(43)
    });
    expect(verifyTurnstile).toHaveBeenCalledOnce();
    expect(verifyTurnstile).toHaveBeenCalledWith(
      expect.objectContaining({
        remoteIp: "203.0.113.10",
        token: "valid-turnstile-token"
      })
    );
  });

  it("rejects an untrusted origin before grant issuance", async () => {
    const issueGrant = vi.fn();
    const response = await handleConnectedSponsorGrant(
      sponsorRequest(validBody, "https://example.com"),
      sponsorEnv,
      { issueGrant }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "origin_rejected" }
    });
    expect(issueGrant).not.toHaveBeenCalled();
  });

  it("rejects an invalid wallet address before Turnstile", async () => {
    const verifyTurnstile = vi.fn(() => Promise.resolve());
    const issueGrant = vi.fn();
    const response = await handleConnectedSponsorGrant(
      sponsorRequest({ ...validBody, walletAddress: "not-an-address" }),
      sponsorEnv,
      { issueGrant, verifyTurnstile }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_sponsor_request" }
    });
    expect(issueGrant).not.toHaveBeenCalled();
    expect(verifyTurnstile).not.toHaveBeenCalled();
  });

  it("fails closed before Turnstile when sponsorship is disabled", async () => {
    const verifyTurnstile = vi.fn(() => Promise.resolve());
    const response = await handleConnectedSponsorGrant(
      sponsorRequest(validBody),
      { ...sponsorEnv, SPONSOR_ENABLED: "false" },
      { verifyTurnstile }
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "sponsor_unavailable" }
    });
    expect(verifyTurnstile).not.toHaveBeenCalled();
  });
});
