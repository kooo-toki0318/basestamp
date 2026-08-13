import { describe, expect, it } from "vitest";
import { createCoreApp } from "../worker/app";
import {
  EXPECTED_SECURITY_CONTACT_URL,
  SECURITY_POLICY_URL,
  SECURITY_TXT_CANONICAL_URL,
  SECURITY_TXT_EXPIRES,
  createSecurityTxt
} from "../worker/security-txt";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("RFC 9116 security.txt", () => {
  const configuredEnv = {
    SECURITY_CONTACT_URL: EXPECTED_SECURITY_CONTACT_URL
  };

  it("serves the canonical policy as UTF-8 plain text", async () => {
    const response = await createCoreApp().request(
      "https://basestamp-web.ndun000.workers.dev/.well-known/security.txt",
      undefined,
      configuredEnv
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8"
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    await expect(response.text()).resolves.toBe(
      createSecurityTxt(EXPECTED_SECURITY_CONTACT_URL)
    );
  });

  it("fails closed until a verified security contact is configured", async () => {
    const response = await createCoreApp().request(
      "https://basestamp-web.ndun000.workers.dev/.well-known/security.txt",
      undefined,
      {}
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("3600");
    await expect(response.text()).resolves.toBe(
      "Security contact is not configured.\n"
    );
  });

  it("uses only the verified HTTPS contact, canonical, and policy URLs", () => {
    const body = createSecurityTxt(EXPECTED_SECURITY_CONTACT_URL);
    if (body === undefined) {
      throw new Error("Expected security.txt for the verified contact.");
    }
    expect(body).toContain(`Contact: ${EXPECTED_SECURITY_CONTACT_URL}\n`);
    expect(body).toContain(`Canonical: ${SECURITY_TXT_CANONICAL_URL}\n`);
    expect(body).toContain(`Policy: ${SECURITY_POLICY_URL}\n`);
    expect(body).toContain("Preferred-Languages: ja, en\n");
    expect(body.endsWith("\n")).toBe(true);

    for (const value of [
      EXPECTED_SECURITY_CONTACT_URL,
      SECURITY_TXT_CANONICAL_URL,
      SECURITY_POLICY_URL
    ]) {
      expect(new URL(value).protocol).toBe("https:");
    }
  });

  it("fails CI inside the 30-day renewal window or at one year", () => {
    const remainingMs = Date.parse(SECURITY_TXT_EXPIRES) - Date.now();
    expect(remainingMs).toBeGreaterThan(30 * DAY_MS);
    expect(remainingMs).toBeLessThan(365 * DAY_MS);
  });
});
