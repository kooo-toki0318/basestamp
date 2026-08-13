import { describe, expect, it } from "vitest";
import { createCoreApp } from "../worker/app";
import type { Bindings } from "../worker/types";

const app = createCoreApp();
const emptyEnv = {} as Bindings;
const configuredEnv = {
  SIWE_ALLOWED_DOMAIN: "localhost:5173",
  SIWE_ALLOWED_ORIGIN: "http://localhost:5173",
  SIWE_CHAIN_IDS: "84532,8453",
  SESSION_HASH_SECRET: "x".repeat(32)
} as unknown as Bindings;
const sponsorEnv = {
  ...configuredEnv,
  SPONSOR_ENABLED: "true",
  SPONSOR_ALLOWED_ORIGINS: "https://keys.coinbase.com",
  SPONSOR_POLICY_VERSION: "1",
  SPONSOR_ID_HMAC_SECRET: "i".repeat(32),
  TURNSTILE_ALLOWED_HOSTNAMES: "basestamp-web.ndun000.workers.dev",
  TURNSTILE_SECRET_KEY: "t".repeat(32)
} as Bindings;

describe("Core Worker surface", () => {
  it("serves a no-store health response with security headers", async () => {
    const response = await app.request("/api/health", undefined, emptyEnv);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "basestamp-core",
      milestone: "2b"
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("requires an authenticated session before issuing a handoff challenge", async () => {
    const response = await createCoreApp({
      readHandoffStamp: () => Promise.resolve({
        contentCommitment:
          "0x1111111111111111111111111111111111111111111111111111111111111111"
      })
    }).request(
      "/api/handoff/challenge",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173"
        },
        body: JSON.stringify({
          stampId:
            "0x2222222222222222222222222222222222222222222222222222222222222222"
        })
      },
      configuredEnv
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "authentication_required" }
    });
  });

  it("has no file upload endpoint", async () => {
    const response = await app.request(
      "/api/upload",
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: "file bytes"
      },
      emptyEnv
    );
    expect(response.status).toBe(404);
  });


  it("rejects authentication on a chain outside the configured Base allowlist", async () => {
    const response = await app.request(
      "/api/auth/nonce",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173"
        },
        body: JSON.stringify({ chainId: 1 })
      },
      configuredEnv
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unsupported_chain" }
    });
  });
  it("fails closed when authentication configuration is absent", async () => {
    const response = await app.request(
      "/api/auth/nonce",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173"
        },
        body: "{}"
      },
      emptyEnv
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "auth_not_configured" }
    });
  });

  it("fails closed before Siteverify when sponsorship is disabled", async () => {
    let turnstileCalled = false;
    const response = await createCoreApp({
      verifyTurnstile: () => {
        turnstileCalled = true;
        return Promise.resolve();
      }
    }).request(
      "/api/sponsor/grant",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173"
        },
        body: JSON.stringify({
          chainId: 84532,
          idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
          turnstileToken: "token"
        })
      },
      configuredEnv
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "sponsor_unavailable" }
    });
    expect(turnstileCalled).toBe(false);
  });

  it("requires a session before redeeming a Turnstile token", async () => {
    let turnstileCalled = false;
    const response = await createCoreApp({
      readSession: () => Promise.resolve(null),
      verifyTurnstile: () => {
        turnstileCalled = true;
        return Promise.resolve();
      }
    }).request(
      "/api/sponsor/grant",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173"
        },
        body: JSON.stringify({
          chainId: 84532,
          idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
          turnstileToken: "token"
        })
      },
      sponsorEnv
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "authentication_required" }
    });
    expect(turnstileCalled).toBe(false);
  });

  it("binds a verified Turnstile token to the authenticated Sepolia wallet grant", async () => {
    const walletAddress = "0x1111111111111111111111111111111111111111";
    let turnstileCalled = false;
    const response = await createCoreApp({
      readSession: () =>
        Promise.resolve({
          wallet_address: walletAddress,
          chain_id: 84532,
          expires_at: 1_786_492_800
        }),
      verifyTurnstile: (verification) => {
        turnstileCalled = true;
        expect(verification.token).toBe("valid-turnstile-token");
        expect(verification.remoteIp).toBe("203.0.113.10");
        expect(verification.allowedHostnames.has(
          "basestamp-web.ndun000.workers.dev"
        )).toBe(true);
        return Promise.resolve();
      },
      issueSponsorGrant: async (_env, arguments_) => {
        expect(arguments_.walletAddress.toLowerCase()).toBe(walletAddress);
        expect(arguments_.chainId).toBe(84532);
        await arguments_.verifyHuman();
        return {
          claimId: "65e41858-cd5e-4c75-b9e4-9a772d748949",
          expiresAt: "2026-08-11T08:15:00Z",
          grantToken: "g".repeat(43)
        };
      }
    }).request(
      "/api/sponsor/grant",
      {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "203.0.113.10",
          "Content-Type": "application/json",
          Origin: "http://localhost:5173"
        },
        body: JSON.stringify({
          chainId: 84532,
          idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
          turnstileToken: "valid-turnstile-token"
        })
      },
      sponsorEnv
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      claimId: "65e41858-cd5e-4c75-b9e4-9a772d748949",
      expiresAt: "2026-08-11T08:15:00Z",
      grantToken: "g".repeat(43)
    });
    expect(turnstileCalled).toBe(true);
  });

  it("routes wallet Paymaster JSON-RPC through the server-side sponsor proxy", async () => {
    const body = {
      jsonrpc: "2.0",
      id: 9,
      method: "pm_getPaymasterData",
      params: [{}, "entrypoint", "chain", { claimId: "claim" }]
    };
    let proxyCalled = false;
    const response = await createCoreApp({
      proxyPaymaster: (_env, request, remoteIp) => {
        proxyCalled = true;
        expect(request).toEqual(body);
        expect(remoteIp).toBe("203.0.113.10");
        return Promise.resolve({
          id: 9,
          result: { paymasterAndData: "0x1234" }
        });
      }
    }).request(
      "/api/sponsor",
      {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "203.0.113.10",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      },
      emptyEnv
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: 9,
      result: { paymasterAndData: "0x1234" }
    });
    expect(proxyCalled).toBe(true);
  });

  it("allows the Base Account popup to preflight the Paymaster proxy", async () => {
    const response = await createCoreApp().request(
      "/api/sponsor",
      {
        method: "OPTIONS",
        headers: {
          "Access-Control-Request-Headers": "content-type",
          "Access-Control-Request-Method": "POST",
          Origin: "https://keys.coinbase.com"
        }
      },
      sponsorEnv
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://keys.coinbase.com"
    );
    expect(response.headers.get("access-control-allow-methods")).toBe("POST");
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "Content-Type"
    );
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "cross-origin"
    );
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("returns Paymaster errors to the trusted popup through CORS", async () => {
    const response = await createCoreApp({
      proxyPaymaster: () =>
        Promise.reject(
          new Error("provider response intentionally failed in this test")
        )
    }).request(
      "/api/sponsor",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://keys.coinbase.com"
        },
        body: "{}"
      },
      sponsorEnv
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://keys.coinbase.com"
    );
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "internal_error" }
    });
  });

  it("rejects untrusted Paymaster origins and preflight headers", async () => {
    let proxyCalled = false;
    const paymasterApp = createCoreApp({
      proxyPaymaster: () => {
        proxyCalled = true;
        return Promise.resolve({ id: 1, result: { paymasterAndData: "0x12" } });
      }
    });
    const originResponse = await paymasterApp.request(
      "/api/sponsor",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://example.com"
        },
        body: "{}"
      },
      sponsorEnv
    );
    expect(originResponse.status).toBe(403);
    expect(originResponse.headers.get("access-control-allow-origin")).toBeNull();

    const headerResponse = await paymasterApp.request(
      "/api/sponsor",
      {
        method: "OPTIONS",
        headers: {
          "Access-Control-Request-Headers": "authorization, content-type",
          "Access-Control-Request-Method": "POST",
          Origin: "https://keys.coinbase.com"
        }
      },
      sponsorEnv
    );
    expect(headerResponse.status).toBe(403);
    expect(proxyCalled).toBe(false);
  });

  it("fails closed at the Paymaster endpoint while sponsorship is disabled", async () => {
    const response = await app.request(
      "/api/sponsor",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      },
      configuredEnv
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "sponsor_unavailable" }
    });
  });
});
