import { SPONSOR_TURNSTILE_ACTION } from "../src/lib/sponsor";
import { ApiError } from "./http";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TURNSTILE_TOKEN_LENGTH = 2048;
const SITEVERIFY_TIMEOUT_MS = 10_000;

type TurnstileResult = {
  action?: unknown;
  hostname?: unknown;
  success?: unknown;
};

export type TurnstileVerification = {
  allowedHostnames: ReadonlySet<string>;
  remoteIp?: string;
  secret: string;
  token: string;
};

export type TurnstileVerifier = (
  verification: TurnstileVerification
) => Promise<void>;

function rejectTurnstile(): never {
  throw new ApiError(
    403,
    "turnstile_rejected",
    "Human verification failed."
  );
}

function isTurnstileResult(value: unknown): value is TurnstileResult {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function verifyTurnstileToken(
  verification: TurnstileVerification,
  fetcher: typeof fetch = fetch
): Promise<void> {
  if (
    verification.secret.length === 0 ||
    verification.token.length === 0 ||
    verification.token.length > MAX_TURNSTILE_TOKEN_LENGTH ||
    verification.allowedHostnames.size === 0
  ) {
    rejectTurnstile();
  }

  const body = new URLSearchParams({
    secret: verification.secret,
    response: verification.token,
    idempotency_key: crypto.randomUUID()
  });
  if (verification.remoteIp !== undefined) {
    body.set("remoteip", verification.remoteIp);
  }

  let response: Response;
  let result: unknown;
  try {
    response = await fetcher(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS)
    });
    result = await response.json();
  } catch {
    rejectTurnstile();
  }

  if (
    !response.ok ||
    !isTurnstileResult(result) ||
    result.success !== true ||
    result.action !== SPONSOR_TURNSTILE_ACTION ||
    typeof result.hostname !== "string" ||
    !verification.allowedHostnames.has(result.hostname)
  ) {
    rejectTurnstile();
  }
}
