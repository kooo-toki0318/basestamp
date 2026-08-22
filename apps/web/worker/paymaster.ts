import {
  createPublicClient,
  isAddressEqual,
  http,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport
} from "viem";
import { base, baseSepolia } from "viem/chains";
import {
  BASE_ACCOUNT_ENTRY_POINT,
  BASE_ACCOUNT_FACTORY_V1,
  BASE_ACCOUNT_FACTORY_V1_1,
  BASE_ACCOUNT_IMPLEMENTATION_V1,
  BASE_ACCOUNT_IMPLEMENTATION_V1_1,
  baseAccountAbi,
  baseAccountFactoryAbi
} from "../src/lib/base-account";
import {
  BASE_SEPOLIA_DEPLOYMENT
} from "../src/lib/deployment";
import type { SupportedChainId } from "../src/lib/networks";
import { SPONSOR_TURNSTILE_ACTION } from "../src/lib/sponsor";
import { hmacSha256Hex, sha256Hex } from "./crypto";
import { ApiError } from "./http";
import {
  validatePaymasterEnvelope,
  type ValidatedPaymasterEnvelope,
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
const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const SPONSOR_ICON_DATA_PATTERN =
  /^data:(image\/(?:gif|jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/iu;
const MAX_PAYMASTER_AND_DATA_BYTES = 4_096;
const MAX_SPONSOR_ICON_URI_BYTES = 12_288;
const MAX_SPONSOR_NAME_CHARACTERS = 100;
const ZERO_PAYMASTER_ADDRESS = "0x" + "0".repeat(40);

type SponsorMetadata = {
  icon?: string;
  name: string;
};

type PaymasterResult = {
  paymasterAndData: Hex;
  isFinal?: boolean;
  sponsor?: SponsorMetadata;
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
  isWalletQuotaBypassed(arguments_: {
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
    monthStart: number;
    now: number;
    policyVersion: number;
    walletQuotaBypassed: boolean;
  }): Promise<void>;
};

export type PaymasterAccountVerifier = (
  request: ValidatedPaymasterEnvelope
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

function requireBuilderCode(env: Bindings): string {
  const builderCode = env.BASE_BUILDER_CODE?.trim() ?? "";
  if (!BUILDER_CODE_PATTERN.test(builderCode)) {
    throw new ApiError(
      503,
      "sponsor_not_configured",
      "Sponsorship is not configured."
    );
  }
  return builderCode;
}

function requirePaymasterUrl(value: string | undefined): string {
  const paymasterUrlValue = value?.trim() ?? "";
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
  return paymasterUrl.href;
}

function getPaymasterConfig(
  env: Bindings,
  chainId: SupportedChainId,
  builderCode: string
) {
  const sponsorConfig = getSponsorConfig(env);
  const paymasterUrl =
    chainId === base.id
      ? requirePaymasterUrl(env.CDP_PAYMASTER_URL_MAINNET)
      : requirePaymasterUrl(env.CDP_PAYMASTER_URL);

  return {
    builderCode,
    ipBucketHmacSecret: requireSecret(env.IP_BUCKET_HMAC_SECRET),
    paymasterUrl,
    policyVersion: sponsorConfig.policyVersion,
    sponsorIdHmacSecret: sponsorConfig.sponsorIdHmacSecret
  };
}

function requireMainnetRpcUrl(env: Bindings): string {
  const value = env.MAINNET_RPC_URL?.trim() ?? "";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ApiError(
      503,
      "sponsor_not_configured",
      "Sponsorship is not configured."
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new ApiError(
      503,
      "sponsor_not_configured",
      "Sponsorship is not configured."
    );
  }
  return value;
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

function requestFingerprint(request: ValidatedPaymasterEnvelope): Promise<string> {
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

function isExpectedImageData(
  mediaType: string,
  data: Uint8Array
): boolean {
  if (mediaType === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((byte, index) => data[index] === byte);
  }
  if (mediaType === "image/webp") {
    return (
      data.length >= 12 &&
      String.fromCharCode(...data.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...data.slice(8, 12)) === "WEBP"
    );
  }
  if (mediaType === "image/jpeg") {
    return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  return (
    mediaType === "image/gif" &&
    data.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(String.fromCharCode(...data.slice(0, 6)))
  );
}

function requireSafeSponsorIcon(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    new TextEncoder().encode(value).byteLength > MAX_SPONSOR_ICON_URI_BYTES
  ) {
    return undefined;
  }
  const match = SPONSOR_ICON_DATA_PATTERN.exec(value);
  if (match === null) return undefined;
  const [, rawMediaType, payload] = match;
  if (!BASE64_PATTERN.test(payload)) return undefined;
  let binary: string;
  try {
    binary = globalThis.atob(payload);
  } catch {
    return undefined;
  }
  if (binary.length === 0) return undefined;
  const data = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return isExpectedImageData(rawMediaType.toLowerCase(), data)
    ? value
    : undefined;
}

function isSafeSponsorName(value: string): boolean {
  const characters = Array.from(value);
  return (
    value.trim() === value &&
    characters.length >= 1 &&
    characters.length <= MAX_SPONSOR_NAME_CHARACTERS &&
    characters.every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return !(
        codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069)
      );
    })
  );
}

function requireSponsorMetadata(value: unknown): SponsorMetadata {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["name", "icon"]) ||
    typeof value.name !== "string" ||
    !isSafeSponsorName(value.name)
  ) {
    providerUnavailable();
  }
  const icon = requireSafeSponsorIcon(value.icon);
  return icon === undefined ? { name: value.name } : { name: value.name, icon };
}

function requireProviderResult(
  value: unknown,
  method: ValidatedPaymasterRequest["method"]
): PaymasterResult {
  const allowedKeys =
    method === "pm_getPaymasterStubData"
      ? ["paymasterAndData", "sponsor", "isFinal"]
      : ["paymasterAndData"];
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, allowedKeys) ||
    typeof value.paymasterAndData !== "string" ||
    !HEX_DATA_PATTERN.test(value.paymasterAndData) ||
    value.paymasterAndData.length < 42 ||
    value.paymasterAndData.length > MAX_PAYMASTER_AND_DATA_BYTES * 2 + 2 ||
    value.paymasterAndData.slice(0, 42).toLowerCase() ===
      ZERO_PAYMASTER_ADDRESS ||
    (value.isFinal !== undefined && typeof value.isFinal !== "boolean")
  ) {
    providerUnavailable();
  }
  return {
    paymasterAndData: value.paymasterAndData as Hex,
    ...(value.isFinal === undefined ? {} : { isFinal: value.isFinal }),
    ...(value.sponsor === undefined
      ? {}
      : { sponsor: requireSponsorMetadata(value.sponsor) })
  };
}

function readStoredResult(
  value: string,
  method: ValidatedPaymasterRequest["method"]
): PaymasterResult {
  try {
    return requireProviderResult(JSON.parse(value) as unknown, method);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return providerUnavailable();
  }
}

function createProviderPayload(
  request: ValidatedPaymasterEnvelope
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
  request: ValidatedPaymasterEnvelope
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
  return requireProviderResult(response.result, request.method);
}

function rejectUnsupportedAccount(): never {
  return rejectSponsorship(
    "sponsor_account_rejected",
    "Account is not supported for sponsorship."
  );
}

function getSupportedAccountVersion(factory: Address) {
  if (isAddressEqual(factory, BASE_ACCOUNT_FACTORY_V1)) {
    return {
      factory: BASE_ACCOUNT_FACTORY_V1,
      implementation: BASE_ACCOUNT_IMPLEMENTATION_V1
    };
  }

  if (isAddressEqual(factory, BASE_ACCOUNT_FACTORY_V1_1)) {
    return {
      factory: BASE_ACCOUNT_FACTORY_V1_1,
      implementation: BASE_ACCOUNT_IMPLEMENTATION_V1_1
    };
  }

  return rejectUnsupportedAccount();
}

function isSupportedImplementation(
  implementation: Address
): boolean {
  return (
    isAddressEqual(
      implementation,
      BASE_ACCOUNT_IMPLEMENTATION_V1
    ) ||
    isAddressEqual(
      implementation,
      BASE_ACCOUNT_IMPLEMENTATION_V1_1
    )
  );
}

async function verifyBaseAccountWithClient<
  transport extends Transport,
  chain extends Chain | undefined
>(
  client: PublicClient<transport, chain>,
  request: ValidatedPaymasterRequest
): Promise<void> {
  try {
    const block = await client.getBlock();

    const senderCode = await client.getCode({
      address: request.sender,
      blockNumber: block.number
    });

    if (request.counterfactualAccount !== null) {
      if (senderCode !== undefined && senderCode !== "0x") {
        rejectUnsupportedAccount();
      }

      const accountVersion = getSupportedAccountVersion(
        request.counterfactualAccount.factory
      );

      const [factoryCode, implementationCode] =
        await Promise.all([
          client.getCode({
            address: accountVersion.factory,
            blockNumber: block.number
          }),
          client.getCode({
            address: accountVersion.implementation,
            blockNumber: block.number
          })
        ]);

      if (
        factoryCode === undefined ||
        factoryCode === "0x" ||
        implementationCode === undefined ||
        implementationCode === "0x"
      ) {
        rejectUnsupportedAccount();
      }

      const factoryImplementation =
        await client.readContract({
          address: accountVersion.factory,
          abi: baseAccountFactoryAbi,
          functionName: "implementation",
          blockNumber: block.number
        });

      if (
        !isAddressEqual(
          factoryImplementation,
          accountVersion.implementation
        )
      ) {
        rejectUnsupportedAccount();
      }

      const predictedAddress =
        await client.readContract({
          address: accountVersion.factory,
          abi: baseAccountFactoryAbi,
          functionName: "getAddress",
          args: [
            request.counterfactualAccount.owners,
            request.counterfactualAccount.nonce
          ],
          blockNumber: block.number
        });

      if (
        !isAddressEqual(
          predictedAddress,
          request.sender
        )
      ) {
        rejectUnsupportedAccount();
      }

      return;
    }

    if (
      senderCode === undefined ||
      senderCode === "0x"
    ) {
      rejectUnsupportedAccount();
    }

    const [entryPoint, implementation] =
      await Promise.all([
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
      !isAddressEqual(
        entryPoint,
        BASE_ACCOUNT_ENTRY_POINT
      ) ||
      !isSupportedImplementation(implementation)
    ) {
      rejectUnsupportedAccount();
    }

    const implementationCode =
      await client.getCode({
        address: implementation,
        blockNumber: block.number
      });

    if (
      implementationCode === undefined ||
      implementationCode === "0x"
    ) {
      rejectUnsupportedAccount();
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    rejectUnsupportedAccount();
  }
}

export async function defaultVerifyBaseAccount(
  env: Bindings,
  request: ValidatedPaymasterRequest
): Promise<void> {
  if (request.chainId === base.id) {
    const client = createPublicClient({
      chain: base,
      transport: http(requireMainnetRpcUrl(env))
    });
    return verifyBaseAccountWithClient(client, request);
  }

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(BASE_SEPOLIA_DEPLOYMENT.rpcUrl)
  });
  return verifyBaseAccountWithClient(client, request);
}

function claimIsAuthorized(
  claim: SponsorClaim | null,
  arguments_: {
    chainId: SupportedChainId;
    grantTokenHash: string;
    grantWalletKey: string;
    now: number;
    policyVersion: number;
  }
): claim is SponsorClaim {
  return (
    claim !== null &&
    claim.action === SPONSOR_TURNSTILE_ACTION &&
    claim.chainId === arguments_.chainId &&
    claim.policyVersion === arguments_.policyVersion &&
    claim.grantExpiresAt > arguments_.now &&
    claim.grantTokenHash === arguments_.grantTokenHash &&
    claim.grantWalletKey === arguments_.grantWalletKey
  );
}

export function utcMonthStart(now: number): number {
  const date = new Date(now * 1_000);
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1_000
  );
}

export async function proxyPaymasterRequest(
  arguments_: ProxyPaymasterArguments
): Promise<ProxyPaymasterResponse> {
  getSponsorConfig(arguments_.env);

  const builderCode = requireBuilderCode(arguments_.env);
  let request: ValidatedPaymasterEnvelope;
  try {
    request = validatePaymasterEnvelope(arguments_.request);
  } catch (error) {
    if (error instanceof ApiError) {
      console.warn(JSON.stringify({
        event: "sponsor_proxy_rejected",
        stage: "request_envelope"
      }));
    }
    throw error;
  }
  const config = getPaymasterConfig(
    arguments_.env,
    request.chainId,
    builderCode
  );
  const now = arguments_.now ?? Math.floor(Date.now() / 1_000);
  const dayStart = Math.floor(now / 86_400) * 86_400;
  const monthStart = utcMonthStart(now);
  const repository =
    arguments_.repository ?? createD1SponsorProxyRepository(arguments_.env.DB);
  const grantTokenHash = await sha256Hex(request.context.grantToken);
  const grantWalletKey = await createWalletSponsorKey(
    config.sponsorIdHmacSecret,
    request.chainId,
    request.sender
  );
  const fingerprintHash = await requestFingerprint(request);
  const claim = await repository.findClaim(request.context.claimId);
  if (!claimIsAuthorized(claim, {
    chainId: request.chainId,
    grantTokenHash,
    grantWalletKey,
    now,
    policyVersion: config.policyVersion
  })) {
    console.warn(JSON.stringify({
      event: "sponsor_proxy_rejected",
      stage: "grant_authorization",
      method: request.method,
      chainId: request.chainId
    }));
    rejectSponsorship();
  }

  if (
    claim.status === "sponsored" &&
    claim.requestFingerprintHash === fingerprintHash &&
    claim.providerResponseJson !== null
  ) {
    return {
      id: request.id,
      result: readStoredResult(claim.providerResponseJson, request.method)
    };
  }
  if (
    request.method === "pm_getPaymasterStubData" &&
    claim.status === "grant_issued" &&
    claim.stubFingerprintHash === fingerprintHash &&
    claim.stubResponseJson !== null
  ) {
    return {
      id: request.id,
      result: readStoredResult(claim.stubResponseJson, request.method)
    };
  }
  if (claim.status !== "grant_issued") rejectSponsorship();

  if (arguments_.accountVerifier !== undefined) {
    // Optional hook for tests or explicit deployments. Production deliberately
    // leaves wallet/account internals to Base Account + the CDP Paymaster.
    await arguments_.accountVerifier(request);
  }
  const ipBucketKey = await createIpBucketKey(
    config.ipBucketHmacSecret,
    arguments_.remoteIp,
    dayStart
  );
  const walletQuotaBypassed = await repository.isWalletQuotaBypassed({
    action: SPONSOR_TURNSTILE_ACTION,
    chainId: request.chainId,
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
    monthStart,
    now,
    policyVersion: config.policyVersion,
    walletQuotaBypassed
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
  function quotaReleaseStatements(claimId: string): D1PreparedStatement[] {
    return [
      database.prepare(
        "UPDATE rate_limit_buckets SET count = count - 1, " +
          "updated_at = unixepoch() WHERE bucket_key = " +
          "(SELECT request_ip_bucket_key FROM sponsor_claims " +
          "WHERE claim_id = ? AND status = 'requested') AND count > 0"
      ).bind(claimId),
      database.prepare(
        "UPDATE quota_counters SET count = count - 1, " +
          "updated_at = unixepoch() WHERE counter_key = " +
          "'sponsor:global:day:' || (SELECT request_day_start " +
          "FROM sponsor_claims WHERE claim_id = ? AND status = 'requested') " +
          "AND count > 0"
      ).bind(claimId),
      database.prepare(
        "UPDATE quota_counters SET count = count - 1, " +
          "updated_at = unixepoch() WHERE counter_key = " +
          "'sponsor:wallet:month:' || (SELECT request_month_start " +
          "FROM sponsor_claims WHERE claim_id = ? AND status = 'requested') " +
          "|| ':' || (SELECT reserved_wallet_key FROM sponsor_claims " +
          "WHERE claim_id = ? AND status = 'requested') AND count > 0"
      ).bind(claimId, claimId)
    ];
  }

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
      const globalCounterKey =
        `sponsor:global:day:${String(reservation.dayStart)}`;
      const walletCounterKey =
        `sponsor:wallet:month:${String(reservation.monthStart)}:` +
        reservation.grantWalletKey;
      let results: D1Result[];
      try {
        results = await database.batch([
          database.prepare(
            "INSERT INTO rate_limit_buckets " +
              "(bucket_key, window_start, count, expires_at, updated_at) " +
              "VALUES (?, ?, 1, ?, ?) ON CONFLICT(bucket_key) DO UPDATE SET " +
              "count = rate_limit_buckets.count + 1, " +
              "updated_at = excluded.updated_at " +
              "WHERE rate_limit_buckets.window_start = excluded.window_start"
          ).bind(
            reservation.ipBucketKey,
            reservation.dayStart,
            reservation.dayStart + 172_800,
            reservation.now
          ),
          database.prepare(
            "INSERT INTO quota_counters " +
              "(counter_key, period_kind, period_start, count, updated_at) " +
              "VALUES (?, 'day', ?, 1, ?) " +
              "ON CONFLICT(counter_key) DO UPDATE SET " +
              "count = quota_counters.count + 1, " +
              "updated_at = excluded.updated_at " +
              "WHERE quota_counters.period_kind = 'day' " +
              "AND quota_counters.period_start = excluded.period_start"
          ).bind(globalCounterKey, reservation.dayStart, reservation.now),
          database.prepare(
            "INSERT INTO quota_counters " +
              "(counter_key, period_kind, period_start, count, updated_at) " +
              "SELECT ?, 'month', ?, 1, ? WHERE ? = 0 " +
              "ON CONFLICT(counter_key) DO UPDATE SET " +
              "count = quota_counters.count + 1, " +
              "updated_at = excluded.updated_at " +
              "WHERE quota_counters.period_kind = 'month' " +
              "AND quota_counters.period_start = excluded.period_start"
          ).bind(
            walletCounterKey,
            reservation.monthStart,
            reservation.now,
            reservation.walletQuotaBypassed ? 1 : 0
          ),
          database.prepare(
            "UPDATE sponsor_claims SET status = 'requested', " +
              "reserved_wallet_key = CASE WHEN ? = 1 THEN NULL " +
              "ELSE grant_wallet_key END, wallet_lifetime_bypassed = ?, " +
              "request_ip_bucket_key = ?, " +
              "request_day_start = ?, request_month_start = ?, " +
              "request_method = ?, " +
              "request_fingerprint_hash = ?, requested_at = ? " +
              "WHERE claim_id = ? AND status = 'grant_issued' " +
              "AND grant_token_hash = ? AND grant_wallet_key = ? " +
              "AND policy_version = ? AND grant_expires_at > ?"
          ).bind(
            reservation.walletQuotaBypassed ? 1 : 0,
            reservation.walletQuotaBypassed ? 1 : 0,
            reservation.ipBucketKey,
            reservation.dayStart,
            reservation.monthStart,
            reservation.method,
            reservation.fingerprintHash,
            reservation.now,
            reservation.claimId,
            reservation.grantTokenHash,
            reservation.grantWalletKey,
            reservation.policyVersion,
            reservation.now
          ),
          database.prepare(
            "INSERT INTO sponsor_reservation_assertions (claim_id, valid) " +
              "VALUES (?, CASE WHEN EXISTS (" +
              "SELECT 1 FROM sponsor_claims WHERE claim_id = ? " +
              "AND status = 'requested' AND request_fingerprint_hash = ?) " +
              "AND COALESCE((SELECT count <= 3 FROM rate_limit_buckets " +
              "WHERE bucket_key = ? AND window_start = ?), 0) = 1 " +
              "AND COALESCE((SELECT count <= 10 FROM quota_counters " +
              "WHERE counter_key = ? AND period_kind = 'day' " +
              "AND period_start = ?), 0) = 1 " +
              "AND (? = 1 OR COALESCE((SELECT count <= 3 " +
              "FROM quota_counters WHERE counter_key = ? " +
              "AND period_kind = 'month' AND period_start = ?), 0) = 1) " +
              "THEN 1 ELSE 0 END)"
          ).bind(
            reservation.claimId,
            reservation.claimId,
            reservation.fingerprintHash,
            reservation.ipBucketKey,
            reservation.dayStart,
            globalCounterKey,
            reservation.dayStart,
            reservation.walletQuotaBypassed ? 1 : 0,
            walletCounterKey,
            reservation.monthStart
          ),
          database.prepare(
            "DELETE FROM sponsor_reservation_assertions WHERE claim_id = ?"
          ).bind(reservation.claimId)
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (
          message.includes("CHECK constraint failed") ||
          message.includes("UNIQUE constraint failed")
        ) {
          reservationRejected();
        }
        throw error;
      }
      if (results[3]?.meta.changes !== 1) reservationRejected();
    },
    async completeStub(completion) {
      const results = await database.batch([
        ...quotaReleaseStatements(completion.claimId),
        database.prepare(
          "UPDATE sponsor_claims SET status = 'grant_issued', " +
            "reserved_wallet_key = NULL, stub_fingerprint_hash = ?, " +
            "stub_response_json = ?, request_ip_bucket_key = NULL, " +
            "request_day_start = NULL, request_month_start = NULL, " +
            "request_method = NULL, " +
            "request_fingerprint_hash = NULL, requested_at = NULL " +
            "WHERE claim_id = ? AND status = 'requested'"
        ).bind(
          completion.fingerprintHash,
          completion.responseJson,
          completion.claimId
        )
      ]);
      const result = results[3];
      if (result.meta.changes !== 1) throw new Error("Sponsor stub state conflict.");
    },
    async completeSponsored(completion) {
      const result = await database.prepare(
        "UPDATE sponsor_claims SET status = 'sponsored', " +
          "wallet_sponsor_key = NULL, reserved_wallet_key = NULL, " +
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
      await database.batch([
        ...quotaReleaseStatements(claimId),
        database.prepare(
          "UPDATE sponsor_claims SET status = 'grant_issued', " +
            "reserved_wallet_key = NULL, request_ip_bucket_key = NULL, " +
            "request_day_start = NULL, request_month_start = NULL, " +
            "request_method = NULL, " +
            "request_fingerprint_hash = NULL, requested_at = NULL, " +
            "wallet_lifetime_bypassed = 0 " +
            "WHERE claim_id = ? AND status = 'requested'"
        ).bind(claimId)
      ]);
    },
    async deny(claimId, now) {
      await database.batch([
        ...quotaReleaseStatements(claimId),
        database.prepare(
          "UPDATE sponsor_claims SET status = 'denied', " +
            "reserved_wallet_key = NULL, terminal_at = ? " +
            "WHERE claim_id = ? AND status = 'requested'"
        ).bind(now, claimId)
      ]);
    },
    async isWalletQuotaBypassed(arguments_) {
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
