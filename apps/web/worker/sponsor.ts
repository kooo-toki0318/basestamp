import {
  getAddress,
  hexToBytes,
  numberToBytes,
  type Address
} from "viem";
import {
  SPONSOR_GRANT_TTL_SECONDS,
  type SponsorGrantResponse
} from "../src/lib/sponsor";
import { hmacSha256, hmacSha256Hex, sha256Hex } from "./crypto";
import { ApiError } from "./http";
import type { Bindings } from "./types";

const encoder = new TextEncoder();
const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type SponsorConfig = {
  allowedHostnames: ReadonlySet<string>;
  policyVersion: number;
  sponsorIdHmacSecret: string;
  turnstileSecret: string;
};

export type SponsorGrantRecord = {
  claimId: string;
  expiresAt: number;
  grantTokenHash: string;
  grantWalletKey: string;
  idempotencyKeyHash: string;
};

export type SponsorGrantRepository = {
  findByIdempotencyKeyHash(
    idempotencyKeyHash: string
  ): Promise<SponsorGrantRecord | null>;
  insertGrant(record: SponsorGrantRecord & {
    action: string;
    chainId: number;
    createdAt: number;
    policyVersion: number;
    turnstileVerifiedAt: number;
  }): Promise<void>;
};

export type IssueSponsorGrantArguments = {
  action: string;
  chainId: 84532;
  config: SponsorConfig;
  idempotencyKey: string;
  now?: number;
  repository: SponsorGrantRepository;
  verifyHuman: () => Promise<void>;
  walletAddress: Address;
};

function bytesToBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function requireConfiguredSecret(value: string | undefined): string {
  const secret = value ?? "";
  if (secret.length < 32 || secret.trim() !== secret) {
    throw new ApiError(
      503,
      "sponsor_not_configured",
      "Sponsorship is not configured."
    );
  }
  return secret;
}

export function getSponsorConfig(env: Bindings): SponsorConfig {
  if (env.SPONSOR_ENABLED !== "true") {
    throw new ApiError(
      503,
      "sponsor_unavailable",
      "Sponsorship is unavailable."
    );
  }

  const allowedHostnames = new Set(
    (env.TURNSTILE_ALLOWED_HOSTNAMES ?? "")
      .split(",")
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean)
  );
  const policyVersion = Number(env.SPONSOR_POLICY_VERSION);
  if (
    allowedHostnames.size === 0 ||
    !Number.isSafeInteger(policyVersion) ||
    policyVersion < 1
  ) {
    throw new ApiError(
      503,
      "sponsor_not_configured",
      "Sponsorship is not configured."
    );
  }

  return {
    allowedHostnames,
    policyVersion,
    sponsorIdHmacSecret: requireConfiguredSecret(env.SPONSOR_ID_HMAC_SECRET),
    turnstileSecret: requireConfiguredSecret(env.TURNSTILE_SECRET_KEY)
  };
}

export function requireSponsorIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ApiError(
      400,
      "invalid_sponsor_request",
      "Sponsor request is invalid."
    );
  }
  return value;
}

export function requireTurnstileToken(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    throw new ApiError(
      400,
      "invalid_sponsor_request",
      "Sponsor request is invalid."
    );
  }
  return value;
}

export async function createWalletSponsorKey(
  secret: string,
  chainId: number,
  walletAddress: Address
): Promise<string> {
  const chainBytes = numberToBytes(BigInt(chainId), { size: 32 });
  const walletBytes = hexToBytes(getAddress(walletAddress));
  const input = new Uint8Array(chainBytes.length + walletBytes.length);
  input.set(chainBytes, 0);
  input.set(walletBytes, chainBytes.length);
  return hmacSha256Hex(secret, input);
}

async function deriveGrantToken(
  secret: string,
  grantWalletKey: string,
  idempotencyKey: string
): Promise<string> {
  const input = encoder.encode(
    `BaseStamp.SponsorGrant.v1\0${grantWalletKey}:${idempotencyKey}`
  );
  return bytesToBase64Url(await hmacSha256(secret, input));
}

function toGrantResponse(
  record: SponsorGrantRecord,
  grantToken: string
): SponsorGrantResponse {
  return {
    claimId: record.claimId,
    expiresAt: new Date(record.expiresAt * 1000)
      .toISOString()
      .replace(".000Z", "Z"),
    grantToken
  };
}

function recordMatches(
  record: SponsorGrantRecord,
  grantWalletKey: string,
  grantTokenHash: string,
  now: number
): boolean {
  return (
    record.grantWalletKey === grantWalletKey &&
    record.grantTokenHash === grantTokenHash &&
    record.expiresAt > now
  );
}

export async function issueSponsorGrant(
  arguments_: IssueSponsorGrantArguments
): Promise<SponsorGrantResponse> {
  const now = arguments_.now ?? Math.floor(Date.now() / 1000);
  const idempotencyKeyHash = await sha256Hex(arguments_.idempotencyKey);
  const grantWalletKey = await createWalletSponsorKey(
    arguments_.config.sponsorIdHmacSecret,
    arguments_.chainId,
    arguments_.walletAddress
  );
  const grantToken = await deriveGrantToken(
    arguments_.config.sponsorIdHmacSecret,
    grantWalletKey,
    arguments_.idempotencyKey
  );
  const grantTokenHash = await sha256Hex(grantToken);
  const existing = await arguments_.repository.findByIdempotencyKeyHash(
    idempotencyKeyHash
  );
  if (existing !== null) {
    if (recordMatches(existing, grantWalletKey, grantTokenHash, now)) {
      return toGrantResponse(existing, grantToken);
    }
    throw new ApiError(
      403,
      "sponsor_request_conflict",
      "Sponsor request cannot be reused."
    );
  }

  await arguments_.verifyHuman();

  const record: SponsorGrantRecord = {
    claimId: crypto.randomUUID(),
    expiresAt: now + SPONSOR_GRANT_TTL_SECONDS,
    grantTokenHash,
    grantWalletKey,
    idempotencyKeyHash
  };
  try {
    await arguments_.repository.insertGrant({
      ...record,
      action: arguments_.action,
      chainId: arguments_.chainId,
      createdAt: now,
      policyVersion: arguments_.config.policyVersion,
      turnstileVerifiedAt: now
    });
  } catch {
    const raced = await arguments_.repository.findByIdempotencyKeyHash(
      idempotencyKeyHash
    );
    if (raced !== null && recordMatches(raced, grantWalletKey, grantTokenHash, now)) {
      return toGrantResponse(raced, grantToken);
    }
    throw new ApiError(
      403,
      "sponsor_request_conflict",
      "Sponsor request cannot be reused."
    );
  }
  return toGrantResponse(record, grantToken);
}

type SponsorGrantRow = {
  claim_id: string;
  grant_expires_at: number;
  grant_token_hash: string;
  grant_wallet_key: string;
  idempotency_key_hash: string;
};

function mapSponsorGrantRow(row: SponsorGrantRow | null): SponsorGrantRecord | null {
  if (row === null) return null;
  return {
    claimId: row.claim_id,
    expiresAt: row.grant_expires_at,
    grantTokenHash: row.grant_token_hash,
    grantWalletKey: row.grant_wallet_key,
    idempotencyKeyHash: row.idempotency_key_hash
  };
}

export function createD1SponsorGrantRepository(
  database: D1Database
): SponsorGrantRepository {
  return {
    async findByIdempotencyKeyHash(idempotencyKeyHash) {
      const row = await database.prepare(
        "SELECT claim_id, grant_expires_at, grant_token_hash, " +
          "grant_wallet_key, idempotency_key_hash FROM sponsor_claims " +
          "WHERE idempotency_key_hash = ? AND status = 'grant_issued'"
      )
        .bind(idempotencyKeyHash)
        .first<SponsorGrantRow>();
      return mapSponsorGrantRow(row);
    },
    async insertGrant(record) {
      await database.prepare(
        "INSERT INTO sponsor_claims " +
          "(claim_id, wallet_sponsor_key, grant_wallet_key, chain_id, " +
          "action, status, policy_version, idempotency_key_hash, " +
          "grant_token_hash, grant_expires_at, turnstile_verified_at, " +
          "provider_reference_hash, sponsored_at, terminal_at, created_at) " +
          "VALUES (?, NULL, ?, ?, ?, 'grant_issued', ?, ?, ?, ?, ?, " +
          "NULL, NULL, NULL, ?)"
      )
        .bind(
          record.claimId,
          record.grantWalletKey,
          record.chainId,
          record.action,
          record.policyVersion,
          record.idempotencyKeyHash,
          record.grantTokenHash,
          record.expiresAt,
          record.turnstileVerifiedAt,
          record.createdAt
        )
        .run();
    }
  };
}
