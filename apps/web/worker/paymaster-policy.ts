import { Attribution } from "ox/erc8021";
import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  isAddress,
  isAddressEqual,
  numberToHex,
  type Address,
  type Hex
} from "viem";
import {
  BASE_ACCOUNT_ENTRY_POINT,
  BASE_ACCOUNT_FACTORY,
  baseAccountAbi,
  baseAccountFactoryAbi
} from "../src/lib/base-account";
import { getDeployment } from "../src/lib/deployment";
import {
  isSupportedChainId,
  type SupportedChainId
} from "../src/lib/networks";
import { registryAbi } from "../src/lib/registry";
import { ApiError } from "./http";

const BUILDER_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const GRANT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const HEX_DATA_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/u;
const HEX_QUANTITY_PATTERN = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const MAX_CALLDATA_BYTES = 8_192;
const MAX_INIT_CODE_BYTES = 8_192;
const MAX_CALL_GAS = 5_000_000n;
const MAX_VERIFICATION_GAS = 5_000_000n;
const MAX_PRE_VERIFICATION_GAS = 1_000_000n;
const MAX_FEE_PER_GAS = 100_000_000_000n;

type JsonRpcId = number | string;

type PaymasterMethod =
  | "pm_getPaymasterData"
  | "pm_getPaymasterStubData";

export type ParsedCounterfactualAccount = {
  factoryData: Hex;
  nonce: bigint;
  owners: readonly Hex[];
};

export type ValidatedPaymasterRequest = {
  chainId: SupportedChainId;
  call: {
    contentCommitment: Hex;
    metadataHash: Hex;
    stampNonce: Hex;
  };
  context: {
    claimId: string;
    grantToken: string;
  };
  counterfactualAccount: ParsedCounterfactualAccount | null;
  id: JsonRpcId;
  method: PaymasterMethod;
  raw: Record<string, unknown>;
  sender: Address;
};

function rejectPaymasterRequest(): never {
  throw new ApiError(
    403,
    "sponsor_request_rejected",
    "Sponsorship request was rejected."
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[] = allowed
): boolean {
  const keys = Object.keys(value);
  return (
    keys.every((key) => allowed.includes(key)) &&
    required.every((key) => Object.hasOwn(value, key))
  );
}

function requireHexData(value: unknown, maxBytes: number): Hex {
  if (
    typeof value !== "string" ||
    !HEX_DATA_PATTERN.test(value) ||
    (value.length - 2) / 2 > maxBytes
  ) {
    rejectPaymasterRequest();
  }
  return value.toLowerCase() as Hex;
}

function requireQuantity(
  value: unknown,
  maximum = (1n << 256n) - 1n
): bigint {
  if (typeof value !== "string" || !HEX_QUANTITY_PATTERN.test(value)) {
    rejectPaymasterRequest();
  }
  const parsed = BigInt(value);
  if (parsed > maximum) rejectPaymasterRequest();
  return parsed;
}

function requireJsonRpcId(value: unknown): JsonRpcId {
  if (
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0) ||
    (typeof value === "string" && value.length > 0 && value.length <= 128)
  ) {
    return value;
  }
  return rejectPaymasterRequest();
}

function requireSupportedChainId(value: unknown): SupportedChainId {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/u.test(value)) {
    rejectPaymasterRequest();
  }

  let parsed: number;
  try {
    parsed = Number(BigInt(value));
  } catch {
    return rejectPaymasterRequest();
  }

  if (
    !isSupportedChainId(parsed) ||
    value.toLowerCase() !== numberToHex(parsed)
  ) {
    rejectPaymasterRequest();
  }
  return parsed;
}

function requireBuilderSuffix(data: Hex, builderCode: string): Hex {
  if (!BUILDER_CODE_PATTERN.test(builderCode)) rejectPaymasterRequest();

  const expectedSuffix = Attribution.toDataSuffix({ codes: [builderCode] });
  if (!data.endsWith(expectedSuffix.slice(2))) rejectPaymasterRequest();

  let attribution: ReturnType<typeof Attribution.fromData>;
  try {
    attribution = Attribution.fromData(data);
  } catch {
    rejectPaymasterRequest();
  }
  if (
    attribution?.id !== 0 ||
    attribution.codes.length !== 1 ||
    attribution.codes[0] !== builderCode
  ) {
    rejectPaymasterRequest();
  }

  return `0x${data.slice(2, 2 - expectedSuffix.length)}`;
}

function decodeRegistryCall(data: Hex, builderCode: string) {
  const unsuffixedData = requireBuilderSuffix(data, builderCode);
  try {
    const decoded = decodeFunctionData({ abi: registryAbi, data: unsuffixedData });
    if (decoded.functionName !== "createStamp") rejectPaymasterRequest();
    const [contentCommitment, metadataHash, stampNonce] = decoded.args;
    const canonical = encodeFunctionData({
      abi: registryAbi,
      functionName: "createStamp",
      args: [contentCommitment, metadataHash, stampNonce]
    });
    if (canonical !== unsuffixedData) rejectPaymasterRequest();
    if (
      contentCommitment === ZERO_BYTES32 ||
      metadataHash === ZERO_BYTES32 ||
      stampNonce === ZERO_BYTES32
    ) {
      rejectPaymasterRequest();
    }
    return { contentCommitment, metadataHash, stampNonce };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return rejectPaymasterRequest();
  }
}

function decodeAccountCall(
  data: Hex,
  builderCode: string,
  registryAddress: Address
) {
  try {
    const decoded = decodeFunctionData({ abi: baseAccountAbi, data });
    if (decoded.functionName !== "execute") rejectPaymasterRequest();
    const [target, value, registryData] = decoded.args;
    if (
      !isAddressEqual(target, registryAddress) ||
      value !== 0n
    ) {
      rejectPaymasterRequest();
    }
    const canonical = encodeFunctionData({
      abi: baseAccountAbi,
      functionName: "execute",
      args: [target, value, registryData]
    });
    if (canonical !== data) rejectPaymasterRequest();
    return decodeRegistryCall(registryData, builderCode);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return rejectPaymasterRequest();
  }
}

function decodeInitCode(value: unknown): ParsedCounterfactualAccount | null {
  if (value === undefined || value === "0x") return null;
  const initCode = requireHexData(value, MAX_INIT_CODE_BYTES);
  if (initCode.length <= 42) rejectPaymasterRequest();

  const factoryValue = `0x${initCode.slice(2, 42)}`;
  if (!isAddress(factoryValue) || !isAddressEqual(factoryValue, BASE_ACCOUNT_FACTORY)) {
    rejectPaymasterRequest();
  }
  const factoryData: Hex = `0x${initCode.slice(42)}`;
  try {
    const decoded = decodeFunctionData({ abi: baseAccountFactoryAbi, data: factoryData });
    if (decoded.functionName !== "createAccount") rejectPaymasterRequest();
    const [owners, nonce] = decoded.args;
    if (
      owners.length < 1 ||
      owners.length > 8 ||
      owners.some((owner) => requireHexData(owner, 2_048) !== owner)
    ) {
      rejectPaymasterRequest();
    }
    const canonical = encodeFunctionData({
      abi: baseAccountFactoryAbi,
      functionName: "createAccount",
      args: [owners, nonce]
    });
    if (canonical !== factoryData) rejectPaymasterRequest();
    return { factoryData, nonce, owners };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return rejectPaymasterRequest();
  }
}

function requireContext(value: unknown) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["claimId", "grantToken"]) ||
    typeof value.claimId !== "string" ||
    !UUID_V4_PATTERN.test(value.claimId) ||
    typeof value.grantToken !== "string" ||
    !GRANT_TOKEN_PATTERN.test(value.grantToken)
  ) {
    rejectPaymasterRequest();
  }
  return { claimId: value.claimId, grantToken: value.grantToken };
}

function requireUserOperation(
  value: unknown,
  method: PaymasterMethod,
  builderCode: string,
  registryAddress: Address
) {
  if (!isRecord(value)) rejectPaymasterRequest();
  const allowed = [
    "sender",
    "nonce",
    "initCode",
    "callData",
    "callGasLimit",
    "verificationGasLimit",
    "preVerificationGas",
    "maxFeePerGas",
    "maxPriorityFeePerGas"
  ] as const;
  const required = [
    "sender",
    "nonce",
    "callData",
    "callGasLimit",
    "verificationGasLimit",
    "preVerificationGas",
    ...(method === "pm_getPaymasterData"
      ? (["maxFeePerGas", "maxPriorityFeePerGas"] as const)
      : [])
  ];
  if (!hasExactKeys(value, allowed, required)) rejectPaymasterRequest();
  if (typeof value.sender !== "string" || !isAddress(value.sender)) {
    rejectPaymasterRequest();
  }
  const sender = getAddress(value.sender);
  requireQuantity(value.nonce);
  requireQuantity(value.callGasLimit, MAX_CALL_GAS);
  requireQuantity(value.verificationGasLimit, MAX_VERIFICATION_GAS);
  requireQuantity(value.preVerificationGas, MAX_PRE_VERIFICATION_GAS);
  if (value.maxFeePerGas !== undefined) {
    requireQuantity(value.maxFeePerGas, MAX_FEE_PER_GAS);
  }
  if (value.maxPriorityFeePerGas !== undefined) {
    requireQuantity(value.maxPriorityFeePerGas, MAX_FEE_PER_GAS);
  }
  const callData = requireHexData(value.callData, MAX_CALLDATA_BYTES);
  return {
    call: decodeAccountCall(callData, builderCode, registryAddress),
    counterfactualAccount: decodeInitCode(value.initCode),
    sender
  };
}

export function validatePaymasterRequest(
  value: unknown,
  builderCode: string
): ValidatedPaymasterRequest {
  if (!isRecord(value) || !hasExactKeys(value, ["jsonrpc", "id", "method", "params"])) {
    rejectPaymasterRequest();
  }
  if (value.jsonrpc !== "2.0") rejectPaymasterRequest();
  const id = requireJsonRpcId(value.id);
  if (
    value.method !== "pm_getPaymasterStubData" &&
    value.method !== "pm_getPaymasterData"
  ) {
    rejectPaymasterRequest();
  }
  const method = value.method;
  if (!isUnknownArray(value.params) || value.params.length !== 4) {
    rejectPaymasterRequest();
  }
  const [userOperation, entryPoint, rawChainId, context] = value.params;
  if (
    typeof entryPoint !== "string" ||
    !isAddress(entryPoint) ||
    !isAddressEqual(entryPoint, BASE_ACCOUNT_ENTRY_POINT)
  ) {
    rejectPaymasterRequest();
  }
  const chainId = requireSupportedChainId(rawChainId);
  const deployment = getDeployment(chainId);
  const parsedUserOperation = requireUserOperation(
    userOperation,
    method,
    builderCode,
    deployment.registryAddress
  );
  return {
    ...parsedUserOperation,
    chainId,
    context: requireContext(context),
    id,
    method,
    raw: value
  };
}
