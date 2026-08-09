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
} as Bindings;

describe("Core Worker surface", () => {
  it("serves a no-store health response with security headers", async () => {
    const response = await app.request("/api/health", undefined, emptyEnv);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "basestamp-core",
      milestone: "2a"
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
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
});
