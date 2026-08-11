import { describe, expect, it } from "vitest";
import { verifyTurnstileToken } from "../worker/turnstile";

const verification = {
  allowedHostnames: new Set(["basestamp-web.ndun000.workers.dev"]),
  remoteIp: "203.0.113.10",
  secret: "s".repeat(32),
  token: "turnstile-token"
};

function jsonFetcher(value: unknown, status = 200): typeof fetch {
  return () =>
    Promise.resolve(
      Response.json(value, {
        status
      })
    );
}

describe("Turnstile server verification", () => {
  it("submits the token server-side and accepts only the sponsor action and hostname", async () => {
    let submittedBody: URLSearchParams | undefined;
    const fetcher: typeof fetch = (_input, init) => {
      submittedBody = init?.body as URLSearchParams;
      return Promise.resolve(
        Response.json({
          success: true,
          action: "sponsor_stamp",
          hostname: "basestamp-web.ndun000.workers.dev"
        })
      );
    };

    await expect(
      verifyTurnstileToken(verification, fetcher)
    ).resolves.toBeUndefined();
    expect(submittedBody?.get("secret")).toBe(verification.secret);
    expect(submittedBody?.get("response")).toBe(verification.token);
    expect(submittedBody?.get("remoteip")).toBe(verification.remoteIp);
    expect(submittedBody?.get("idempotency_key")).toMatch(
      /^[0-9a-f-]{36}$/u
    );
  });

  it.each([
    ["failed challenge", { success: false }],
    [
      "wrong action",
      {
        success: true,
        action: "login",
        hostname: "basestamp-web.ndun000.workers.dev"
      }
    ],
    [
      "wrong hostname",
      {
        success: true,
        action: "sponsor_stamp",
        hostname: "attacker.example"
      }
    ]
  ])("rejects %s", async (_reason, result) => {
    await expect(
      verifyTurnstileToken(verification, jsonFetcher(result))
    ).rejects.toMatchObject({ code: "turnstile_rejected", status: 403 });
  });

  it("rejects a replayed token", async () => {
    let calls = 0;
    const fetcher: typeof fetch = () => {
      calls += 1;
      return Promise.resolve(
        Response.json(
          calls === 1
            ? {
                success: true,
                action: "sponsor_stamp",
                hostname: "basestamp-web.ndun000.workers.dev"
              }
            : {
                success: false,
                "error-codes": ["timeout-or-duplicate"]
              }
        )
      );
    };

    await expect(
      verifyTurnstileToken(verification, fetcher)
    ).resolves.toBeUndefined();
    await expect(
      verifyTurnstileToken(verification, fetcher)
    ).rejects.toMatchObject({ code: "turnstile_rejected" });
  });

  it("rejects oversized tokens before contacting Siteverify", async () => {
    let contacted = false;
    const fetcher: typeof fetch = () => {
      contacted = true;
      return Promise.resolve(Response.json({ success: true }));
    };
    await expect(
      verifyTurnstileToken(
        { ...verification, token: "x".repeat(2049) },
        fetcher
      )
    ).rejects.toMatchObject({ code: "turnstile_rejected" });
    expect(contacted).toBe(false);
  });
});
