import { getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hex
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { generateSiweNonce, parseSiweMessage } from "viem/siwe";
import { validateSiweFields } from "./auth-policy";
import { detectLocaleFromAcceptLanguage } from "../src/locale-negotiation";
import { hmacSha256Hex, randomHex32, randomToken, sha256Hex } from "./crypto";
import { BASE_SEPOLIA_DEPLOYMENT } from "../src/lib/deployment";
import { registryAbi } from "../src/lib/registry";
import { formatUnixSeconds } from "../src/lib/verification-package";
import {
  HANDOFF_CHALLENGE_TTL_SECONDS,
  HANDOFF_PRIMARY_TYPE,
  HANDOFF_STATEMENT,
  HANDOFF_TYPES,
  createHandoffDomain,
  type HandoffChallenge,
  type HandoffVerification
} from "../src/lib/handoff";
import {
  UnsupportedCounterfactualSignatureError,
  verifyHandoffTypedDataSignature
} from "../src/lib/handoff-signature";
import { ApiError, assertExactKeys, readJsonObject } from "./http";
import type { AuthConfig, Bindings } from "./types";
import {
  SPONSOR_TURNSTILE_ACTION,
  type SponsorGrantResponse
} from "../src/lib/sponsor";
import {
  createD1SponsorGrantRepository,
  getSponsorConfig,
  issueSponsorGrant,
  requireSponsorIdempotencyKey,
  requireTurnstileToken,
  type IssueSponsorGrantArguments
} from "./sponsor";
import {
  verifyTurnstileToken,
  type TurnstileVerifier
} from "./turnstile";
import {
  proxyPaymasterRequest,
  type ProxyPaymasterResponse
} from "./paymaster";
import { readCleanupHealth } from "./cleanup";

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

type HandoffStamp = { contentCommitment: Hex };

type VerifyHandoffArguments = {
  signer: Address;
  challenge: HandoffChallenge;
  signature: Hex;
};

type VerifyHandoffResult = Omit<HandoffVerification, "verified"> & {
  valid: boolean;
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

type SessionReader = (
  env: Bindings,
  config: AuthConfig,
  token: string | undefined
) => Promise<SessionRow | null>;

type SponsorGrantIssuer = (
  env: Bindings,
  arguments_: Omit<IssueSponsorGrantArguments, "repository">
) => Promise<SponsorGrantResponse>;

type SponsorPaymasterProxy = (
  env: Bindings,
  request: unknown,
  remoteIp: string | undefined
) => Promise<ProxyPaymasterResponse>;

type Dependencies = {
  issueSponsorGrant?: SponsorGrantIssuer;
  proxyPaymaster?: SponsorPaymasterProxy;
  readHandoffStamp?: (stampId: Hex) => Promise<HandoffStamp>;
  readSession?: SessionReader;
  verifyHandoffSignature?: (
    arguments_: VerifyHandoffArguments
  ) => Promise<VerifyHandoffResult>;
  verifySiweSignature?: (arguments_: VerifyArguments) => Promise<boolean>;
  verifyTurnstile?: TurnstileVerifier;
};

type HandoffChallengeRow = {
  stamp_id: string;
  statement_version: number;
  wallet_address: string | null;
  chain_id: number | null;
  expires_at: number;
  used_at: number | null;
  created_at: number;
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

function createHandoffPublicClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_DEPLOYMENT.rpcUrl)
  });
}

async function defaultReadHandoffStamp(stampId: Hex): Promise<HandoffStamp> {
  const client = createHandoffPublicClient();
  return client.readContract({
    address: BASE_SEPOLIA_DEPLOYMENT.registryAddress,
    abi: registryAbi,
    functionName: "getStamp",
    args: [stampId]
  });
}

async function defaultVerifyHandoffSignature(
  arguments_: VerifyHandoffArguments
): Promise<VerifyHandoffResult> {
  const client = createHandoffPublicClient();
  const block = await client.getBlock();
  const stamp = await client.readContract({
    address: BASE_SEPOLIA_DEPLOYMENT.registryAddress,
    abi: registryAbi,
    functionName: "getStamp",
    args: [arguments_.challenge.message.stampId],
    blockNumber: block.number
  });
  const signatureResult = await verifyHandoffTypedDataSignature(client, {
    signer: arguments_.signer,
    challenge: arguments_.challenge,
    signature: arguments_.signature,
    blockNumber: block.number
  });
  return {
    valid:
      stamp.contentCommitment ===
        arguments_.challenge.message.contentCommitment &&
      signatureResult.valid,
    signatureValidation: signatureResult.signatureValidation,
    verifiedAt: new Date().toISOString().replace(".000Z", "Z"),
    verification: {
      blockNumber: Number(block.number),
      blockHash: block.hash,
      blockTimestamp: formatUnixSeconds(block.timestamp)
    }
  };
}

async function readSession(
  env: Bindings,
  config: AuthConfig,
  token: string | undefined
): Promise<SessionRow | null> {
  if (token === undefined) return null;
  const tokenHash = await hmacSha256Hex(config.sessionHashSecret, token);
  const now = Math.floor(Date.now() / 1000);
  return env.DB.prepare(
    "SELECT wallet_address, chain_id, expires_at FROM sessions " +
      "WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?"
  )
    .bind(tokenHash, now)
    .first<SessionRow>();
}

function requireBytes32(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) {
    throw new ApiError(400, "invalid_handoff", field + " is invalid.");
  }
  return value as Hex;
}

function requireHandoffSignature(value: unknown): Hex {
  if (
    typeof value !== "string" ||
    value.length > 16_384 ||
    !/^0x(?:[0-9a-fA-F]{2})+$/u.test(value)
  ) {
    throw new ApiError(400, "invalid_handoff", "Handoff signature is invalid.");
  }
  return value.toLowerCase() as Hex;
}

export function createCoreApp(dependencies: Dependencies = {}) {
  const verifySiweSignature =
    dependencies.verifySiweSignature ?? defaultVerifySiweSignature;
  const readHandoffStamp =
    dependencies.readHandoffStamp ?? defaultReadHandoffStamp;
  const verifyHandoffSignature =
    dependencies.verifyHandoffSignature ?? defaultVerifyHandoffSignature;
  const readSessionForRequest = dependencies.readSession ?? readSession;
  const verifyTurnstile =
    dependencies.verifyTurnstile ?? verifyTurnstileToken;
  const issueGrant: SponsorGrantIssuer =
    dependencies.issueSponsorGrant ??
    ((env, arguments_) =>
      issueSponsorGrant({
        ...arguments_,
        repository: createD1SponsorGrantRepository(env.DB)
      }));
  const proxySponsorPaymaster: SponsorPaymasterProxy =
    dependencies.proxyPaymaster ??
    ((env, request, remoteIp) =>
      proxyPaymasterRequest({ env, remoteIp, request }));
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
    context.json({ ok: true, service: "basestamp-core", milestone: "2b" })
  );

  app.get("/api/health/retention", async (context) => {
    const health = await readCleanupHealth(context.env.DB);
    return context.json(
      { ok: health.healthy, cleanup: health },
      health.healthy ? 200 : 503
    );
  });

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
    const session = await readSessionForRequest(context.env, config, token);
    if (session === null) return context.json({ authenticated: false });

    return context.json({
      authenticated: true,
      walletAddress: session.wallet_address,
      chainId: session.chain_id,
      expiresAt: new Date(session.expires_at * 1000).toISOString()
    });
  });

  app.post("/api/sponsor/grant", async (context) => {
    const sponsorConfig = getSponsorConfig(context.env);
    const authConfig = getAuthConfig(context.env);
    requireOrigin(context.req.raw, authConfig);
    const body = await readJsonObject(context.req.raw);
    assertExactKeys(body, ["chainId", "idempotencyKey", "turnstileToken"]);
    if (body.chainId !== BASE_SEPOLIA_DEPLOYMENT.chainId) {
      throw new ApiError(
        400,
        "unsupported_chain",
        "Base Sepolia sponsorship is required."
      );
    }
    const idempotencyKey = requireSponsorIdempotencyKey(body.idempotencyKey);
    const turnstileToken = requireTurnstileToken(body.turnstileToken);
    const session = await readSessionForRequest(
      context.env,
      authConfig,
      getCookie(context, SESSION_COOKIE)
    );
    if (session === null) {
      throw new ApiError(
        403,
        "authentication_required",
        "Authentication is required."
      );
    }
    if (session.chain_id !== BASE_SEPOLIA_DEPLOYMENT.chainId) {
      throw new ApiError(
        400,
        "unsupported_chain",
        "Base Sepolia authentication is required."
      );
    }

    const result = await issueGrant(context.env, {
      action: SPONSOR_TURNSTILE_ACTION,
      chainId: BASE_SEPOLIA_DEPLOYMENT.chainId,
      config: sponsorConfig,
      idempotencyKey,
      verifyHuman: () =>
        verifyTurnstile({
          allowedHostnames: sponsorConfig.allowedHostnames,
          remoteIp: context.req.header("CF-Connecting-IP"),
          secret: sponsorConfig.turnstileSecret,
          token: turnstileToken
        }),
      walletAddress: getAddress(session.wallet_address)
    });
    return context.json(result);
  });

  app.post("/api/sponsor", async (context) => {
    const request = await readJsonObject(context.req.raw);
    const response = await proxySponsorPaymaster(
      context.env,
      request,
      context.req.header("CF-Connecting-IP")
    );
    return context.json({
      jsonrpc: "2.0",
      id: response.id,
      result: response.result
    });
  });

  app.post("/api/handoff/challenge", async (context) => {
    const config = getAuthConfig(context.env);
    requireOrigin(context.req.raw, config);
    const body = await readJsonObject(context.req.raw);
    assertExactKeys(body, ["stampId"]);
    const stampId = requireBytes32(body.stampId, "Stamp ID");

    const session = await readSessionForRequest(
      context.env,
      config,
      getCookie(context, SESSION_COOKIE)
    );
    if (session === null) {
      throw new ApiError(403, "authentication_required", "Authentication is required.");
    }
    if (session.chain_id !== BASE_SEPOLIA_DEPLOYMENT.chainId) {
      throw new ApiError(400, "unsupported_chain", "Base Sepolia authentication is required.");
    }

    const stamp = await readHandoffStamp(stampId);
    const ackNonce = randomHex32();
    const ackNonceHash = await sha256Hex(ackNonce);
    const issuedAt = Math.floor(Date.now() / 1000);
    const challengeExpiresAt = issuedAt + HANDOFF_CHALLENGE_TTL_SECONDS;
    await context.env.DB.prepare(
      "INSERT INTO handoff_challenges " +
        "(ack_nonce_hash, stamp_id, statement_version, wallet_address, " +
        "chain_id, expires_at, used_at, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, NULL, ?)"
    )
      .bind(
        ackNonceHash,
        stampId,
        1,
        session.wallet_address,
        session.chain_id,
        challengeExpiresAt,
        issuedAt
      )
      .run();

    const challenge: HandoffChallenge = {
      domain: createHandoffDomain(),
      types: HANDOFF_TYPES,
      primaryType: HANDOFF_PRIMARY_TYPE,
      message: {
        statement: HANDOFF_STATEMENT,
        version: 1,
        stampId,
        contentCommitment: stamp.contentCommitment,
        ackNonce,
        issuedAt,
        challengeExpiresAt
      }
    };
    return context.json(challenge);
  });

  app.post("/api/handoff/verify", async (context) => {
    const config = getAuthConfig(context.env);
    requireOrigin(context.req.raw, config);
    const body = await readJsonObject(context.req.raw);
    assertExactKeys(body, ["ackNonce", "signature"]);
    const ackNonce = requireBytes32(body.ackNonce, "Acknowledgement nonce");
    const signature = requireHandoffSignature(body.signature);

    const session = await readSessionForRequest(
      context.env,
      config,
      getCookie(context, SESSION_COOKIE)
    );
    if (session === null) {
      throw new ApiError(403, "authentication_required", "Authentication is required.");
    }

    const ackNonceHash = await sha256Hex(ackNonce);
    const now = Math.floor(Date.now() / 1000);
    const row = await context.env.DB.prepare(
      "SELECT stamp_id, statement_version, wallet_address, chain_id, " +
        "expires_at, used_at, created_at FROM handoff_challenges " +
        "WHERE ack_nonce_hash = ?"
    )
      .bind(ackNonceHash)
      .first<HandoffChallengeRow>();
    if (
      row?.statement_version !== 1 ||
      row.wallet_address !== session.wallet_address ||
      row.chain_id !== session.chain_id ||
      row.chain_id !== BASE_SEPOLIA_DEPLOYMENT.chainId ||
      row.used_at !== null ||
      row.expires_at <= now ||
      row.created_at > now + 300 ||
      row.expires_at <= row.created_at ||
      row.expires_at - row.created_at > HANDOFF_CHALLENGE_TTL_SECONDS
    ) {
      throw new ApiError(400, "handoff_challenge_invalid", "Handoff challenge is invalid or expired.");
    }

    const stampId = requireBytes32(row.stamp_id, "Stored stamp ID");
    const stamp = await readHandoffStamp(stampId);
    const challenge: HandoffChallenge = {
      domain: createHandoffDomain(),
      types: HANDOFF_TYPES,
      primaryType: HANDOFF_PRIMARY_TYPE,
      message: {
        statement: HANDOFF_STATEMENT,
        version: 1,
        stampId,
        contentCommitment: stamp.contentCommitment,
        ackNonce,
        issuedAt: row.created_at,
        challengeExpiresAt: row.expires_at
      }
    };

    let result: VerifyHandoffResult;
    try {
      result = await verifyHandoffSignature({
        signer: getAddress(session.wallet_address),
        challenge,
        signature
      });
    } catch (error) {
      if (error instanceof UnsupportedCounterfactualSignatureError) {
        throw new ApiError(400, "counterfactual_not_allowed", error.message);
      }
      throw error;
    }
    if (!result.valid) {
      throw new ApiError(400, "handoff_signature_invalid", "Handoff signature is invalid.");
    }

    const consumed = await context.env.DB.prepare(
      "UPDATE handoff_challenges SET used_at = ? " +
        "WHERE ack_nonce_hash = ? AND wallet_address = ? " +
        "AND used_at IS NULL AND expires_at > ?"
    )
      .bind(now, ackNonceHash, session.wallet_address, now)
      .run();
    if (consumed.meta.changes !== 1) {
      throw new ApiError(400, "handoff_challenge_invalid", "Handoff challenge is invalid or expired.");
    }

    return context.json({
      verified: true,
      signatureValidation: result.signatureValidation,
      verifiedAt: result.verifiedAt,
      verification: result.verification
    } satisfies HandoffVerification);
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
