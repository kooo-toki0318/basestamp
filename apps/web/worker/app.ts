import { getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { createPublicClient, http, isAddress, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";
import { generateSiweNonce, parseSiweMessage } from "viem/siwe";
import { validateSiweFields } from "./auth-policy";
import { detectLocaleFromAcceptLanguage } from "../src/locale-negotiation";
import { hmacSha256Hex, randomToken, sha256Hex } from "./crypto";
import { ApiError, assertExactKeys, readJsonObject } from "./http";
import type { AuthConfig, Bindings } from "./types";

const SESSION_COOKIE = "__Host-basestamp_session";
const NONCE_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

type VerifyArguments = {
  address: Hex;
  chainId: number;
  message: string;
  signature: Hex;
  domain: string;
  nonce: string;
  now: Date;
};

type Dependencies = {
  verifySiweSignature?: (arguments_: VerifyArguments) => Promise<boolean>;
};

type NonceRow = {
  domain: string;
  chain_id: number;
  expires_at: number;
  used_at: number | null;
};

type SessionRow = {
  wallet_address: string;
  chain_id: number;
  expires_at: number;
};

function getAuthConfig(env: Bindings): AuthConfig {
  const domain = env.SIWE_ALLOWED_DOMAIN?.trim() ?? "";
  const origin = env.SIWE_ALLOWED_ORIGIN?.trim() ?? "";
  const chainIds = (env.SIWE_CHAIN_IDS ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value));
  const sessionHashSecret = env.SESSION_HASH_SECRET ?? "";
  const supportedChainIds = new Set<number>([base.id, baseSepolia.id]);

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new ApiError(503, "auth_not_configured", "Authentication is not configured.");
  }

  if (
    parsedOrigin.origin !== origin ||
    parsedOrigin.host !== domain ||
    chainIds.length === 0 ||
    new Set(chainIds).size !== chainIds.length ||
    chainIds.some((chainId) => !supportedChainIds.has(chainId)) ||
    sessionHashSecret.length < 32
  ) {
    throw new ApiError(503, "auth_not_configured", "Authentication is not configured.");
  }

  return {
    domain,
    origin,
    chainIds: chainIds as (8453 | 84532)[],
    sessionHashSecret
  };
}

function isAllowedChainId(
  value: unknown,
  config: AuthConfig
): value is 8453 | 84532 {
  return (
    typeof value === "number" &&
    config.chainIds.includes(value as 8453 | 84532)
  );
}

function requireOrigin(request: Request, config: AuthConfig): void {
  if (request.headers.get("origin") !== config.origin) {
    throw new ApiError(403, "origin_rejected", "Request origin is not allowed.");
  }
}

async function defaultVerifySiweSignature(arguments_: VerifyArguments): Promise<boolean> {
  const chain =
    arguments_.chainId === base.id
      ? base
      : arguments_.chainId === baseSepolia.id
        ? baseSepolia
        : undefined;
  if (chain === undefined) return false;
  const client = createPublicClient({ chain, transport: http() });
  return client.verifySiweMessage({
    address: arguments_.address,
    domain: arguments_.domain,
    message: arguments_.message,
    nonce: arguments_.nonce,
    signature: arguments_.signature,
    time: arguments_.now
  });
}

export function createCoreApp(dependencies: Dependencies = {}) {
  const verifySiweSignature =
    dependencies.verifySiweSignature ?? defaultVerifySiweSignature;
  const app = new Hono<{ Bindings: Bindings }>();


  app.use(
    "/api/*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"]
      },
      referrerPolicy: "no-referrer",
      xFrameOptions: "DENY"
    })
  );
  app.use("/api/*", async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
  });

  app.get("/api/health", (context) =>
    context.json({ ok: true, service: "basestamp-core", milestone: "2a" })
  );

  app.get("/api/locale", (context) => {
    const locale = detectLocaleFromAcceptLanguage(
      context.req.header("Accept-Language") ?? null
    );
    context.header("Content-Language", locale);
    context.header("Vary", "Accept-Language");
    return context.json({ locale });
  });

  app.post("/api/auth/nonce", async (context) => {
    const config = getAuthConfig(context.env);
    requireOrigin(context.req.raw, config);
    const body = await readJsonObject(context.req.raw);
    assertExactKeys(body, ["chainId"]);
    if (!isAllowedChainId(body.chainId, config)) {
      throw new ApiError(400, "unsupported_chain", "Unsupported authentication chain.");
    }
    const chainId = body.chainId;

    const nonce = generateSiweNonce();
    const nonceHash = await sha256Hex(nonce);
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + NONCE_TTL_SECONDS;
    await context.env.DB.prepare(
      "INSERT INTO auth_nonces " +
        "(nonce_hash, domain, chain_id, expires_at, used_at, created_at) " +
        "VALUES (?, ?, ?, ?, NULL, ?)"
    )
      .bind(nonceHash, config.domain, chainId, expiresAt, now)
      .run();

    return context.json({
      nonce,
      domain: config.domain,
      uri: config.origin,
      chainId,
      issuedAt: new Date(now * 1000).toISOString(),
      expirationTime: new Date(expiresAt * 1000).toISOString()
    });
  });

  app.post("/api/auth/verify", async (context) => {
    const config = getAuthConfig(context.env);
    requireOrigin(context.req.raw, config);
    const body = await readJsonObject(context.req.raw);
    assertExactKeys(body, ["message", "signature"]);

    if (
      typeof body.message !== "string" ||
      body.message.length > 4096 ||
      typeof body.signature !== "string" ||
      body.signature.length > 16_384 ||
      !/^0x(?:[0-9a-fA-F]{2})+$/u.test(body.signature)
    ) {
      throw new ApiError(400, "invalid_authentication", "Authentication failed.");
    }

    let fields: ReturnType<typeof parseSiweMessage>;
    try {
      fields = parseSiweMessage(body.message);
    } catch {
      throw new ApiError(400, "invalid_authentication", "Authentication failed.");
    }

    const nowDate = new Date();
    if (!isAllowedChainId(fields.chainId, config)) {
      throw new ApiError(400, "invalid_authentication", "Authentication failed.");
    }
    const chainId = fields.chainId;
    const policyError = validateSiweFields(fields, {
      domain: config.domain,
      origin: config.origin,
      chainId,
      now: nowDate,
      maxClockSkewMs: CLOCK_SKEW_MS,
      maxLifetimeMs: NONCE_TTL_SECONDS * 1000
    });
    if (
      policyError !== null ||
      typeof fields.address !== "string" ||
      !isAddress(fields.address) ||
      typeof fields.nonce !== "string"
    ) {
      throw new ApiError(400, "invalid_authentication", "Authentication failed.");
    }

    const nonceHash = await sha256Hex(fields.nonce);
    const now = Math.floor(nowDate.getTime() / 1000);
    const nonceRow = await context.env.DB.prepare(
      "SELECT domain, chain_id, expires_at, used_at " +
        "FROM auth_nonces WHERE nonce_hash = ?"
    )
      .bind(nonceHash)
      .first<NonceRow>();
    if (
      nonceRow?.domain !== config.domain ||
      nonceRow.chain_id !== chainId ||
      nonceRow.used_at !== null ||
      nonceRow.expires_at <= now
    ) {
      throw new ApiError(400, "invalid_authentication", "Authentication failed.");
    }

    const valid = await verifySiweSignature({
      address: fields.address,
      chainId,
      message: body.message,
      signature: body.signature as Hex,
      domain: config.domain,
      nonce: fields.nonce,
      now: nowDate
    });
    if (!valid) {
      throw new ApiError(400, "invalid_authentication", "Authentication failed.");
    }

    const consumed = await context.env.DB.prepare(
      "UPDATE auth_nonces SET used_at = ? " +
        "WHERE nonce_hash = ? AND used_at IS NULL AND expires_at > ?"
    )
      .bind(now, nonceHash, now)
      .run();
    if (consumed.meta.changes !== 1) {
      throw new ApiError(400, "invalid_authentication", "Authentication failed.");
    }

    const token = randomToken();
    const tokenHash = await hmacSha256Hex(config.sessionHashSecret, token);
    const sessionExpiresAt = now + SESSION_TTL_SECONDS;
    const walletAddress = fields.address.toLowerCase();
    await context.env.DB.prepare(
      "INSERT INTO sessions " +
        "(token_hash, wallet_address, chain_id, expires_at, revoked_at, created_at) " +
        "VALUES (?, ?, ?, ?, NULL, ?)"
    )
      .bind(
        tokenHash,
        walletAddress,
        chainId,
        sessionExpiresAt,
        now
      )
      .run();

    setCookie(context, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS
    });
    return context.json({
      authenticated: true,
      walletAddress,
      chainId,
      expiresAt: new Date(sessionExpiresAt * 1000).toISOString()
    });
  });

  app.get("/api/session", async (context) => {
    const config = getAuthConfig(context.env);
    const token = getCookie(context, SESSION_COOKIE);
    if (token === undefined) return context.json({ authenticated: false });

    const tokenHash = await hmacSha256Hex(config.sessionHashSecret, token);
    const now = Math.floor(Date.now() / 1000);
    const session = await context.env.DB.prepare(
      "SELECT wallet_address, chain_id, expires_at FROM sessions " +
        "WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?"
    )
      .bind(tokenHash, now)
      .first<SessionRow>();
    if (session === null) return context.json({ authenticated: false });

    return context.json({
      authenticated: true,
      walletAddress: session.wallet_address,
      chainId: session.chain_id,
      expiresAt: new Date(session.expires_at * 1000).toISOString()
    });
  });

  app.post("/api/auth/logout", async (context) => {
    const config = getAuthConfig(context.env);
    requireOrigin(context.req.raw, config);
    const body = await readJsonObject(context.req.raw);
    assertExactKeys(body, []);

    const token = getCookie(context, SESSION_COOKIE);
    if (token !== undefined) {
      const tokenHash = await hmacSha256Hex(config.sessionHashSecret, token);
      const now = Math.floor(Date.now() / 1000);
      await context.env.DB.prepare(
        "UPDATE sessions SET revoked_at = ? " +
          "WHERE token_hash = ? AND revoked_at IS NULL"
      )
        .bind(now, tokenHash)
        .run();
    }

    setCookie(context, SESSION_COOKIE, "", {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 0
    });
    return context.json({ authenticated: false });
  });

  app.notFound((context) =>
    context.json({ error: { code: "not_found", message: "Endpoint not found." } }, 404)
  );
  app.onError((error, context) => {
    if (error instanceof ApiError) {
      return context.json(
        { error: { code: error.code, message: error.message } },
        error.status
      );
    }
    return context.json(
      { error: { code: "internal_error", message: "Request failed." } },
      500
    );
  });

  return app;
}

export const coreApp = createCoreApp();
