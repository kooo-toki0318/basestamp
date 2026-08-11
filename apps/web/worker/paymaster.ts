import {
  createPublicClient,
  isAddressEqual,
  keccak256,
  http,
  type Hex
} from "viem";
import { baseSepolia } from "viem/chains";
import {
  BASE_ACCOUNT_ENTRY_POINT,
  BASE_ACCOUNT_FACTORY,
  BASE_ACCOUNT_FACTORY_CODE_HASH,
  BASE_ACCOUNT_IMPLEMENTATION,
  BASE_ACCOUNT_IMPLEMENTATION_CODE_HASH,
  baseAccountAbi,
  baseAccountFactoryAbi
} from "../src/lib/base-account";
import { BASE_SEPOLIA_DEPLOYMENT } from "../src/lib/deployment";
import { SPONSOR_TURNSTILE_ACTION } from "../src/lib/sponsor";
import { hmacSha256Hex, sha256Hex } from "./crypto";
import { ApiError } from "./http";
import {
  validatePaymasterRequest,
  type ValidatedPaymasterRequest
} from "./paymaster-policy";
import {
  createWalletSponsorKey,
  getSponsorConfig
} from "./sponsor";
import type { Bindings } from "./types";

const PROVIDER_TIMEOUT_MS = 10_000;
const MAX_PROVIDER_RESPONSE_BYTES = 20_000;
const BUILDER_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const IP_ADDRESS_PATTERN = /^[0-9A-Fa-f:.]{2,64}$/u;
const HEX_DATA_PATTERN = /^0x(?:[0-9a-fA-F]{2})+$/u;

type PaymasterResult = Record<string, unknown> & {
  paymasterAndData: Hex;
  isFinal?: boolean;
};

export type SponsorClaim = {
  action: string;
  chainId: number;
  grantExpiresAt: number;
  grantTokenHash: string;
  grantWalletKey: string;
  policyVersion: number;
  providerResponseJson: string | null;
  requestFingerprintHash: string | null;
  status: string;
  stubFingerprintHash: string | null;
  stubResponseJson: string | null;
};

export type SponsorProxyRepository = {
  completeSponsored(arguments_: {
    claimId: string;
    fingerprintHash: string;
    now: number;
    providerReferenceHash: string;
    responseJson: string;
  }): Promise<void>;
  completeStub(arguments_: {
    claimId: string;
    fingerprintHash: string;
    responseJson: string;
  }): Promise<void>;
  deny(claimId: string, now: number): Promise<void>;
  findClaim(claimId: string): Promise<SponsorClaim | null>;
  isWalletLifetimeBypassed(arguments_: {
    action: string;
    chainId: number;
    now: number;
    walletAddress: string;
  }): Promise<boolean>;
  release(claimId: string): Promise<void>;
  reserve(arguments_: {
    claimId: string;
    dayStart: number;
    fingerprintHash: string;
    grantTokenHash: string;
    grantWalletKey: string;
    ipBucketKey: string;
    method: ValidatedPaymasterRequest["method"];
    now: number;
    policyVersion: number;
    walletLifetimeBypassed: boolean;
  }): Promise<void>;
};

export type PaymasterAccountVerifier = (
  request: ValidatedPaymasterRequest
) => Promise<void>;

export type PaymasterProvider = (
  url: string,
  payload: Record<string, unknown>
) => Promise<unknown>;

export type ProxyPaymasterArguments = {
  accountVerifier?: PaymasterAccountVerifier;
  env: Bindings;
  now?: number;
  provider?: PaymasterProvider;
  remoteIp: string | undefined;
  repository?: SponsorProxyRepository;
  request: unknown;
};

export type ProxyPaymasterResponse = {
  id: number | string;
  result: PaymasterResult;
};

function rejectSponsorship(
  code = "sponsor_request_rejected",
  message = "Sponsorship request was rejected."
): never {
  throw new ApiError(403, code, message);
}

function providerUnavailable(): never {
  throw new ApiError(
    503,
    "sponsor_provider_unavailable",
    "Sponsorship provider is temporarily unavailable."
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function requireSecret(value: string | undefined): string {
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

function getPaymasterConfig(env: Bindings) {
  const sponsorConfig = getSponsorConfig(env);
  const builderCode = env.BASE_BUILDER_CODE?.trim() ?? "";
  if (!BUILDER_CODE_PATTERN.test(builderCode)) {
    throw new ApiError(
      503,
      "sponsor_not_configured",
      "Sponsorship is not configured."
    );
  }

  const paymasterUrlValue = env.CDP_PAYMASTER_URL?.trim() ?? "";
  let paymasterUrl: URL;
  try {
    paymasterUrl = new URL(paymasterUrlValue);
  } catch {
    throw new ApiError(
      503,
      "sponsor_not_configured",
      "Sponsorship is not configured."
    );
  }
  if (
    paymasterUrl.protocol !== "https:" ||
    paymasterUrl.username !== "" ||
    paymasterUrl.password !== "" ||
    paymasterUrl.hash !== ""
  ) {
    throw new ApiError(
      503,
      "sponsor_not_configured",
      "Sponsorship is not configured."
    );
  }
  return {
    builderCode,
    ipBucketHmacSecret: requireSecret(env.IP_BUCKET_HMAC_SECRET),
    paymasterUrl: paymasterUrl.href,
    policyVersion: sponsorConfig.policyVersion,
    sponsorIdHmacSecret: sponsorConfig.sponsorIdHmacSecret
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  rejectSponsorship();
}

function requestFingerprint(request: ValidatedPaymasterRequest): Promise<string> {
  const params = request.raw.params;
  if (!Array.isArray(params)) rejectSponsorship();
  return sha256Hex(canonicalJson({ method: request.method, params: params.slice(0, 3) }));
}

async function createIpBucketKey(
  secret: string,
  remoteIp: string | undefined,
  dayStart: number
): Promise<string> {
  const ip = remoteIp?.trim().toLowerCase() ?? "";
  if (!IP_ADDRESS_PATTERN.test(ip)) rejectSponsorship();
  return hmacSha256Hex(
    secret,
    `BaseStamp.IPBucket.v1\0${String(dayStart)}:${ip}`
  );
}

function requireProviderResult(value: unknown): PaymasterResult {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["paymasterAndData", "sponsor", "isFinal"]) ||
    typeof value.paymasterAndData !== "string" ||
    !HEX_DATA_PATTERN.test(value.paymasterAndData) ||
    value.paymasterAndData.length > 8_194 ||
    (value.isFinal !== undefined && typeof value.isFinal !== "boolean")
  ) {
    providerUnavailable();
  }
  if (value.sponsor !== undefined) {
    if (
      !isRecord(value.sponsor) ||
      !hasOnlyKeys(value.sponsor, ["name", "icon"]) ||
      typeof value.sponsor.name !== "string" ||
      value.sponsor.name.length < 1 ||
      value.sponsor.name.length > 100 ||
      (value.sponsor.icon !== undefined &&
        (typeof value.sponsor.icon !== "string" ||
          value.sponsor.icon.length > 2_048))
    ) {
      providerUnavailable();
    }
  }
  return value as PaymasterResult;
}

function readStoredResult(value: string): PaymasterResult {
  try {
    return requireProviderResult(JSON.parse(value) as unknown);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return providerUnavailable();
  }
}

function createProviderPayload(
  request: ValidatedPaymasterRequest
): Record<string, unknown> {
  const params = request.raw.params;
  if (!Array.isArray(params) || params.length !== 4) rejectSponsorship();
  return {
    jsonrpc: "2.0",
    id: request.id,
    method: request.method,
    params: [params[0], params[1], params[2], {}]
  };
}

async function defaultPaymasterProvider(
  url: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
    });
    text = await response.text();
  } catch {
    return providerUnavailable();
  }
  if (
    !response.ok ||
    new TextEncoder().encode(text).byteLength > MAX_PROVIDER_RESPONSE_BYTES
  ) {
    return providerUnavailable();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return providerUnavailable();
  }
}

function parseProviderResponse(
  response: unknown,
  request: ValidatedPaymasterRequest
): PaymasterResult {
  if (!isRecord(response) || response.jsonrpc !== "2.0" || response.id !== request.id) {
    providerUnavailable();
  }
  if (Object.hasOwn(response, "error")) {
    rejectSponsorship(
      "sponsor_provider_rejected",
      "Sponsorship provider rejected the request."
    );
  }
  if (!hasOnlyKeys(response, ["jsonrpc", "id", "result"]) || !Object.hasOwn(response, "result")) {
    providerUnavailable();
  }
  return requireProviderResult(response.result);
}

function rejectUnsupportedAccount(): never {
  return rejectSponsorship(
    "sponsor_account_rejected",
    "Account is not supported for sponsorship."
  );
}

async function defaultVerifyBaseAccount(
  request: ValidatedPaymasterRequest
): Promise<void> {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_DEPLOYMENT.rpcUrl)
  });
  try {
    const block = await client.getBlock();
    const [factoryCode, implementationCode, senderCode] = await Promise.all([
      client.getCode({ address: BASE_ACCOUNT_FACTORY, blockNumber: block.number }),
      client.getCode({
        address: BASE_ACCOUNT_IMPLEMENTATION,
        blockNumber: block.number
      }),
      client.getCode({ address: request.sender, blockNumber: block.number })
    ]);
    if (
      factoryCode === undefined ||
      implementationCode === undefined ||
      keccak256(factoryCode) !== BASE_ACCOUNT_FACTORY_CODE_HASH ||
      keccak256(implementationCode) !== BASE_ACCOUNT_IMPLEMENTATION_CODE_HASH
    ) {
      rejectUnsupportedAccount();
    }

    const factoryImplementation = await client.readContract({
      address: BASE_ACCOUNT_FACTORY,
      abi: baseAccountFactoryAbi,
      functionName: "implementation",
      blockNumber: block.number
    });
    if (!isAddressEqual(factoryImplementation, BASE_ACCOUNT_IMPLEMENTATION)) {
      rejectUnsupportedAccount();
    }

    if (request.counterfactualAccount !== null) {
      if (senderCode !== undefined && senderCode !== "0x") rejectUnsupportedAccount();
      const predictedAddress = await client.readContract({
        address: BASE_ACCOUNT_FACTORY,
        abi: baseAccountFactoryAbi,
        functionName: "getAddress",
        args: [
          request.counterfactualAccount.owners,
          request.counterfactualAccount.nonce
        ],
        blockNumber: block.number
      });
      if (!isAddressEqual(predictedAddress, request.sender)) {
        rejectUnsupportedAccount();
      }
      return;
    }

    if (senderCode === undefined || senderCode === "0x") rejectUnsupportedAccount();
    const [entryPoint, implementation] = await Promise.all([
      client.readContract({
        address: request.sender,
        abi: baseAccountAbi,
        functionName: "entryPoint",
        blockNumber: block.number
      }),
      client.readContract({
        address: request.sender,
        abi: baseAccountAbi,
        functionName: "implementation",
        blockNumber: block.number
      })
    ]);
    if (
      !isAddressEqual(entryPoint, BASE_ACCOUNT_ENTRY_POINT) ||
      !isAddressEqual(implementation, BASE_ACCOUNT_IMPLEMENTATION)
    ) {
      rejectUnsupportedAccount();
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    rejectUnsupportedAccount();
  }
}

function claimIsAuthorized(
  claim: SponsorClaim | null,
  arguments_: {
    grantTokenHash: string;
    grantWalletKey: string;
    now: number;
    policyVersion: number;
  }
): claim is SponsorClaim {
  return (
    claim !== null &&
    claim.action === SPONSOR_TURNSTILE_ACTION &&
    claim.chainId === BASE_SEPOLIA_DEPLOYMENT.chainId &&
    claim.policyVersion === arguments_.policyVersion &&
    claim.grantExpiresAt > arguments_.now &&
    claim.grantTokenHash === arguments_.grantTokenHash &&
    claim.grantWalletKey === arguments_.grantWalletKey
  );
}

export async function proxyPaymasterRequest(
  arguments_: ProxyPaymasterArguments
): Promise<ProxyPaymasterResponse> {
  const config = getPaymasterConfig(arguments_.env);
  const request = validatePaymasterRequest(arguments_.request, config.builderCode);
  const now = arguments_.now ?? Math.floor(Date.now() / 1_000);
  const dayStart = Math.floor(now / 86_400) * 86_400;
  const repository =
    arguments_.repository ?? createD1SponsorProxyRepository(arguments_.env.DB);
  const grantTokenHash = await sha256Hex(request.context.grantToken);
  const grantWalletKey = await createWalletSponsorKey(
    config.sponsorIdHmacSecret,
    BASE_SEPOLIA_DEPLOYMENT.chainId,
    request.sender
  );
  const fingerprintHash = await requestFingerprint(request);
  const claim = await repository.findClaim(request.context.claimId);
  if (!claimIsAuthorized(claim, {
    grantTokenHash,
    grantWalletKey,
    now,
    policyVersion: config.policyVersion
  })) {
    rejectSponsorship();
  }

  if (
    claim.status === "sponsored" &&
    claim.requestFingerprintHash === fingerprintHash &&
    claim.providerResponseJson !== null
  ) {
    return { id: request.id, result: readStoredResult(claim.providerResponseJson) };
  }
  if (
    request.method === "pm_getPaymasterStubData" &&
    claim.status === "grant_issued" &&
    claim.stubFingerprintHash === fingerprintHash &&
    claim.stubResponseJson !== null
  ) {
    return { id: request.id, result: readStoredResult(claim.stubResponseJson) };
  }
  if (claim.status !== "grant_issued") rejectSponsorship();

  await (arguments_.accountVerifier ?? defaultVerifyBaseAccount)(request);
  const ipBucketKey = await createIpBucketKey(
    config.ipBucketHmacSecret,
    arguments_.remoteIp,
    dayStart
  );
  const walletLifetimeBypassed = await repository.isWalletLifetimeBypassed({
    action: SPONSOR_TURNSTILE_ACTION,
    chainId: BASE_SEPOLIA_DEPLOYMENT.chainId,
    now,
    walletAddress: request.sender.toLowerCase()
  });
  await repository.reserve({
    claimId: request.context.claimId,
    dayStart,
    fingerprintHash,
    grantTokenHash,
    grantWalletKey,
    ipBucketKey,
    method: request.method,
    now,
    policyVersion: config.policyVersion,
    walletLifetimeBypassed
  });

  let providerResponse: unknown;
  try {
    providerResponse = await (arguments_.provider ?? defaultPaymasterProvider)(
      config.paymasterUrl,
      createProviderPayload(request)
    );
  } catch (error) {
    await repository.release(request.context.claimId);
    if (error instanceof ApiError) throw error;
    return providerUnavailable();
  }

  let result: PaymasterResult;
  try {
    result = parseProviderResponse(providerResponse, request);
  } catch (error) {
    if (error instanceof ApiError && error.code === "sponsor_provider_rejected") {
      await repository.deny(request.context.claimId, now);
    } else {
      await repository.release(request.context.claimId);
    }
    throw error;
  }

  const responseJson = JSON.stringify(result);
  if (new TextEncoder().encode(responseJson).byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
    await repository.release(request.context.claimId);
    providerUnavailable();
  }
  const providerReferenceHash = await sha256Hex(responseJson);
  if (request.method === "pm_getPaymasterData" || result.isFinal === true) {
    await repository.completeSponsored({
      claimId: request.context.claimId,
      fingerprintHash,
      now,
      providerReferenceHash,
      responseJson
    });
  } else {
    await repository.completeStub({
      claimId: request.context.claimId,
      fingerprintHash,
      responseJson
    });
  }
  return { id: request.id, result };
}

type SponsorClaimRow = {
  action: string;
  chain_id: number;
  grant_expires_at: number;
  grant_token_hash: string;
  grant_wallet_key: string;
  policy_version: number;
  provider_response_json: string | null;
  request_fingerprint_hash: string | null;
  status: string;
  stub_fingerprint_hash: string | null;
  stub_response_json: string | null;
};

function mapClaim(row: SponsorClaimRow | null): SponsorClaim | null {
  if (row === null) return null;
  return {
    action: row.action,
    chainId: row.chain_id,
    grantExpiresAt: row.grant_expires_at,
    grantTokenHash: row.grant_token_hash,
    grantWalletKey: row.grant_wallet_key,
    policyVersion: row.policy_version,
    providerResponseJson: row.provider_response_json,
    requestFingerprintHash: row.request_fingerprint_hash,
    status: row.status,
    stubFingerprintHash: row.stub_fingerprint_hash,
    stubResponseJson: row.stub_response_json
  };
}

function reservationRejected(): never {
  return rejectSponsorship(
    "sponsor_quota_exceeded",
    "Sponsorship is not available for this request."
  );
}

export function createD1SponsorProxyRepository(
  database: D1Database
): SponsorProxyRepository {
  return {
    async findClaim(claimId) {
      const row = await database.prepare(
        "SELECT action, chain_id, grant_expires_at, grant_token_hash, " +
          "grant_wallet_key, policy_version, provider_response_json, " +
          "request_fingerprint_hash, status, stub_fingerprint_hash, " +
          "stub_response_json FROM sponsor_claims WHERE claim_id = ?"
      )
        .bind(claimId)
        .first<SponsorClaimRow>();
      return mapClaim(row);
    },
    async reserve(reservation) {
      let result: D1Result;
      try {
        result = await database.prepare(
          "UPDATE sponsor_claims SET status = 'requested', " +
            "reserved_wallet_key = CASE WHEN ? = 1 THEN NULL " +
            "ELSE grant_wallet_key END, wallet_lifetime_bypassed = ?, " +
            "request_ip_bucket_key = ?, " +
            "request_day_start = ?, request_method = ?, " +
            "request_fingerprint_hash = ?, requested_at = ? " +
            "WHERE claim_id = ? AND status = 'grant_issued' " +
            "AND grant_token_hash = ? AND grant_wallet_key = ? " +
            "AND policy_version = ? AND grant_expires_at > ? " +
            "AND (? = 1 OR NOT EXISTS (SELECT 1 FROM sponsor_claims AS used " +
            "WHERE used.wallet_sponsor_key = sponsor_claims.grant_wallet_key " +
            "AND used.chain_id = sponsor_claims.chain_id " +
            "AND used.action = sponsor_claims.action))"
        )
          .bind(
            reservation.walletLifetimeBypassed ? 1 : 0,
            reservation.walletLifetimeBypassed ? 1 : 0,
            reservation.ipBucketKey,
            reservation.dayStart,
            reservation.method,
            reservation.fingerprintHash,
            reservation.now,
            reservation.claimId,
            reservation.grantTokenHash,
            reservation.grantWalletKey,
            reservation.policyVersion,
            reservation.now,
            reservation.walletLifetimeBypassed ? 1 : 0
          )
          .run();
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (
          message.includes("sponsor_ip_quota") ||
          message.includes("sponsor_global_quota") ||
          message.includes("UNIQUE constraint failed")
        ) {
          reservationRejected();
        }
        throw error;
      }
      if (result.meta.changes !== 1) reservationRejected();
    },
    async completeStub(completion) {
      const result = await database.prepare(
        "UPDATE sponsor_claims SET status = 'grant_issued', " +
          "reserved_wallet_key = NULL, stub_fingerprint_hash = ?, " +
          "stub_response_json = ?, request_ip_bucket_key = NULL, " +
          "request_day_start = NULL, request_method = NULL, " +
          "request_fingerprint_hash = NULL, requested_at = NULL " +
          "WHERE claim_id = ? AND status = 'requested'"
      )
        .bind(completion.fingerprintHash, completion.responseJson, completion.claimId)
        .run();
      if (result.meta.changes !== 1) throw new Error("Sponsor stub state conflict.");
    },
    async completeSponsored(completion) {
      const result = await database.prepare(
        "UPDATE sponsor_claims SET status = 'sponsored', " +
          "wallet_sponsor_key = CASE WHEN wallet_lifetime_bypassed = 1 " +
          "THEN NULL ELSE grant_wallet_key END, reserved_wallet_key = NULL, " +
          "provider_reference_hash = ?, provider_response_json = ?, " +
          "request_fingerprint_hash = ?, sponsored_at = ?, terminal_at = ? " +
          "WHERE claim_id = ? AND status = 'requested'"
      )
        .bind(
          completion.providerReferenceHash,
          completion.responseJson,
          completion.fingerprintHash,
          completion.now,
          completion.now,
          completion.claimId
        )
        .run();
      if (result.meta.changes !== 1) {
        throw new Error("Sponsor completion state conflict.");
      }
    },
    async release(claimId) {
      await database.prepare(
        "UPDATE sponsor_claims SET status = 'grant_issued', " +
          "reserved_wallet_key = NULL, request_ip_bucket_key = NULL, " +
          "request_day_start = NULL, request_method = NULL, " +
          "request_fingerprint_hash = NULL, requested_at = NULL, " +
          "wallet_lifetime_bypassed = 0 " +
          "WHERE claim_id = ? AND status = 'requested'"
      )
        .bind(claimId)
        .run();
    },
    async deny(claimId, now) {
      await database.prepare(
        "UPDATE sponsor_claims SET status = 'denied', " +
          "reserved_wallet_key = NULL, terminal_at = ? " +
          "WHERE claim_id = ? AND status = 'requested'"
      )
        .bind(now, claimId)
        .run();
    },
    async isWalletLifetimeBypassed(arguments_) {
      const row = await database.prepare(
        "SELECT 1 AS allowed FROM sponsor_wallet_allowlist " +
          "WHERE wallet_address = ? AND chain_id = ? AND action = ? " +
          "AND expires_at > ?"
      )
        .bind(
          arguments_.walletAddress,
          arguments_.chainId,
          arguments_.action,
          arguments_.now
        )
        .first<{ allowed: number }>();
      return row?.allowed === 1;
    }
  };
}
