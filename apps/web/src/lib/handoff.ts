import {
  getAddress,
  isAddress,
  isAddressEqual,
  type Address,
  type Hex
} from "viem";
import { BYTES32_HEX_PATTERN, base64UrlToBytes32 } from "./crypto";
import {
  BASE_SEPOLIA_DEPLOYMENT,
  getDeployment
} from "./deployment";
import {
  isSupportedChainId,
  type SupportedChainId
} from "./networks";
import { createHandoffPath } from "./routes";
import { assertStrictJsonSyntax } from "./verification-package";

export const HANDOFF_STATEMENT =
  "I verified in my browser that the selected file matches the content commitment associated with this BaseStamp record.";
export const HANDOFF_PRIMARY_TYPE = "HandoffReceipt" as const;
export const HANDOFF_VERSION = 1 as const;
export const HANDOFF_CHALLENGE_TTL_SECONDS = 10 * 60;
export const MAX_HANDOFF_RECEIPT_BYTES = 64 * 1024;

export const HANDOFF_EIP712_DOMAIN_FIELDS = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" }
] as const;

export const HANDOFF_MESSAGE_FIELDS = [
  { name: "statement", type: "string" },
  { name: "version", type: "uint32" },
  { name: "stampId", type: "bytes32" },
  { name: "contentCommitment", type: "bytes32" },
  { name: "ackNonce", type: "bytes32" },
  { name: "issuedAt", type: "uint64" },
  { name: "challengeExpiresAt", type: "uint64" }
] as const;

export const HANDOFF_TYPES = {
  HandoffReceipt: HANDOFF_MESSAGE_FIELDS
} as const;

export const HANDOFF_RECEIPT_TYPES = {
  EIP712Domain: HANDOFF_EIP712_DOMAIN_FIELDS,
  HandoffReceipt: HANDOFF_MESSAGE_FIELDS
} as const;

export type HandoffDomain = {
  name: "BaseStamp";
  version: "1";
  chainId: SupportedChainId;
  verifyingContract: Address;
};

export type HandoffMessage = {
  statement: typeof HANDOFF_STATEMENT;
  version: 1;
  stampId: Hex;
  contentCommitment: Hex;
  ackNonce: Hex;
  issuedAt: number;
  challengeExpiresAt: number;
};

export type HandoffChallenge = {
  domain: HandoffDomain;
  types: typeof HANDOFF_TYPES;
  primaryType: typeof HANDOFF_PRIMARY_TYPE;
  message: HandoffMessage;
};

export type SignatureValidation = "eoa" | "erc1271" | "erc6492";

export type HandoffVerification = {
  verified: true;
  signatureValidation: SignatureValidation;
  verifiedAt: string;
  verification: {
    blockNumber: number;
    blockHash: Hex;
    blockTimestamp: string;
  };
};

export type HandoffReceipt = {
  schemaVersion: 1;
  type: "BaseStampHandoffReceipt";
  primaryType: typeof HANDOFF_PRIMARY_TYPE;
  domain: HandoffDomain;
  types: typeof HANDOFF_RECEIPT_TYPES;
  message: HandoffMessage;
  signer: Address;
  signature: Hex;
  verificationMethod: "EIP-712";
  signatureValidation: SignatureValidation;
  verifiedAt: string;
  verification: HandoffVerification["verification"];
  verificationUrl: string;
};

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(field + " must be an object.");
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  field: string
): void {
  const actual = Object.keys(value).sort();
  const accepted = [...expected].sort();
  if (
    actual.length !== accepted.length ||
    actual.some((key, index) => key !== accepted[index])
  ) {
    throw new Error(field + " contains unsupported fields.");
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(field + " must be a string.");
  return value;
}

function requireInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(field + " must be an allowed integer.");
  }
  return value;
}

function requireSupportedChainId(
  value: unknown,
  field: string
): SupportedChainId {
  if (typeof value !== "number" || !isSupportedChainId(value)) {
    throw new Error(field + " must be a supported Base chain ID.");
  }
  return value;
}

function requireBytes32(value: unknown, field: string): Hex {
  const text = requireString(value, field);
  if (!BYTES32_HEX_PATTERN.test(text)) {
    throw new Error(field + " must be lowercase bytes32 hex.");
  }
  return text as Hex;
}

function requireAddress(value: unknown, field: string): Address {
  const text = requireString(value, field);
  if (!isAddress(text, { strict: true })) {
    throw new Error(field + " must be a valid address.");
  }
  return getAddress(text);
}

function requireTimestamp(value: unknown, field: string): string {
  const text = requireString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(text)) {
    throw new Error(field + " must be UTC RFC 3339 seconds.");
  }
  const parsed = new Date(text);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().replace(".000Z", "Z") !== text
  ) {
    throw new Error(field + " must be a real UTC timestamp.");
  }
  return text;
}

function requireTypeFields(
  value: unknown,
  expected: readonly { readonly name: string; readonly type: string }[],
  field: string
): void {
  if (!Array.isArray(value) || value.length !== expected.length) {
    throw new Error(field + " does not match the fixed EIP-712 schema.");
  }
  for (const [index, expectedField] of expected.entries()) {
    const candidate = requireRecord(value[index], field);
    requireExactKeys(candidate, ["name", "type"], field);
    if (
      candidate.name !== expectedField.name ||
      candidate.type !== expectedField.type
    ) {
      throw new Error(field + " does not match the fixed EIP-712 schema.");
    }
  }
}

function requireSignature(value: unknown): Hex {
  const text = requireString(value, "Signature");
  if (
    text.length > 16_384 ||
    !/^0x(?:[0-9a-fA-F]{2})+$/u.test(text)
  ) {
    throw new Error("Signature must be bounded even-length hex.");
  }
  return text.toLowerCase() as Hex;
}

export function createHandoffDomain(
  chainId: SupportedChainId = BASE_SEPOLIA_DEPLOYMENT.chainId
): HandoffDomain {
  const deployment = getDeployment(chainId);
  return {
    name: "BaseStamp",
    version: "1",
    chainId: deployment.chainId,
    verifyingContract: deployment.registryAddress
  };
}

export function createHandoffUrl(
  origin: string,
  stampId: Hex,
  contentSalt: string,
  chainId?: SupportedChainId
): string {
  base64UrlToBytes32(contentSalt);
  if (!BYTES32_HEX_PATTERN.test(stampId)) {
    throw new Error("Stamp ID must be lowercase bytes32 hex.");
  }
  const pathname =
    chainId === undefined
      ? "/handoff/" + stampId
      : createHandoffPath(chainId, stampId);
  const url = new URL(pathname, origin);
  url.hash = "k=" + contentSalt;
  return url.toString();
}

export function parseHandoffFragment(hash: string): Uint8Array {
  const match = /^#k=([A-Za-z0-9_-]{43})$/u.exec(hash);
  if (match?.[1] === undefined) {
    throw new Error("Handoff URL fragment is missing or invalid.");
  }
  return base64UrlToBytes32(match[1]);
}

export function parseHandoffChallenge(
  value: unknown,
  expectedStampId: Hex,
  expectedContentCommitment: Hex,
  nowSeconds = Math.floor(Date.now() / 1000),
  expectedChainId: SupportedChainId = BASE_SEPOLIA_DEPLOYMENT.chainId
): HandoffChallenge {
  const challenge = requireRecord(value, "Handoff challenge");
  requireExactKeys(
    challenge,
    ["domain", "types", "primaryType", "message"],
    "Handoff challenge"
  );
  if (challenge.primaryType !== HANDOFF_PRIMARY_TYPE) {
    throw new Error("Handoff challenge primary type is invalid.");
  }

  const deployment = getDeployment(expectedChainId);
  const domain = requireRecord(challenge.domain, "Handoff challenge domain");
  requireExactKeys(
    domain,
    ["name", "version", "chainId", "verifyingContract"],
    "Handoff challenge domain"
  );
  const verifyingContract = requireAddress(
    domain.verifyingContract,
    "Handoff challenge verifying contract"
  );
  if (
    domain.name !== "BaseStamp" ||
    domain.version !== "1" ||
    domain.chainId !== deployment.chainId ||
    !isAddressEqual(verifyingContract, deployment.registryAddress)
  ) {
    throw new Error("Handoff challenge domain is invalid.");
  }

  const types = requireRecord(challenge.types, "Handoff challenge types");
  requireExactKeys(types, ["HandoffReceipt"], "Handoff challenge types");
  requireTypeFields(
    types.HandoffReceipt,
    HANDOFF_MESSAGE_FIELDS,
    "Handoff challenge fields"
  );

  const message = requireRecord(challenge.message, "Handoff challenge message");
  requireExactKeys(
    message,
    [
      "statement",
      "version",
      "stampId",
      "contentCommitment",
      "ackNonce",
      "issuedAt",
      "challengeExpiresAt"
    ],
    "Handoff challenge message"
  );
  const stampId = requireBytes32(message.stampId, "Handoff challenge stamp ID");
  const contentCommitment = requireBytes32(
    message.contentCommitment,
    "Handoff challenge content commitment"
  );
  const ackNonce = requireBytes32(
    message.ackNonce,
    "Handoff challenge acknowledgement nonce"
  );
  const issuedAt = requireInteger(message.issuedAt, "Handoff issued-at", 1);
  const challengeExpiresAt = requireInteger(
    message.challengeExpiresAt,
    "Handoff challenge expiry",
    issuedAt + 1,
    issuedAt + HANDOFF_CHALLENGE_TTL_SECONDS
  );
  if (
    message.statement !== HANDOFF_STATEMENT ||
    message.version !== 1 ||
    stampId !== expectedStampId ||
    contentCommitment !== expectedContentCommitment ||
    issuedAt > nowSeconds + 300 ||
    challengeExpiresAt <= nowSeconds
  ) {
    throw new Error("Handoff challenge does not match the verified record.");
  }

  return {
    domain: createHandoffDomain(expectedChainId),
    types: HANDOFF_TYPES,
    primaryType: HANDOFF_PRIMARY_TYPE,
    message: {
      statement: HANDOFF_STATEMENT,
      version: 1,
      stampId,
      contentCommitment,
      ackNonce,
      issuedAt,
      challengeExpiresAt
    }
  };
}

export function parseHandoffVerification(
  value: unknown,
  chainId: SupportedChainId = BASE_SEPOLIA_DEPLOYMENT.chainId
): HandoffVerification {
  const result = requireRecord(value, "Handoff verification");
  requireExactKeys(
    result,
    ["verified", "signatureValidation", "verifiedAt", "verification"],
    "Handoff verification"
  );
  if (result.verified !== true) {
    throw new Error("Handoff signature was not verified.");
  }
  if (
    result.signatureValidation !== "eoa" &&
    result.signatureValidation !== "erc1271" &&
    result.signatureValidation !== "erc6492"
  ) {
    throw new Error("Handoff signature validation method is invalid.");
  }
  const deployment = getDeployment(chainId);
  const verifiedAt = requireTimestamp(result.verifiedAt, "Handoff verified-at");
  const verification = requireRecord(
    result.verification,
    "Handoff verification block"
  );
  requireExactKeys(
    verification,
    ["blockNumber", "blockHash", "blockTimestamp"],
    "Handoff verification block"
  );
  return {
    verified: true,
    signatureValidation: result.signatureValidation,
    verifiedAt,
    verification: {
      blockNumber: requireInteger(
        verification.blockNumber,
        "Handoff verification block number",
        Number(deployment.deploymentBlock)
      ),
      blockHash: requireBytes32(
        verification.blockHash,
        "Handoff verification block hash"
      ),
      blockTimestamp: requireTimestamp(
        verification.blockTimestamp,
        "Handoff verification block timestamp"
      )
    }
  };
}

export function serializeHandoffReceipt(value: HandoffReceipt): string {
  return JSON.stringify(value, null, 2) + "\n";
}

export function parseHandoffReceipt(
  source: string,
  expectedOrigin: string
): HandoffReceipt {
  if (new TextEncoder().encode(source).byteLength > MAX_HANDOFF_RECEIPT_BYTES) {
    throw new Error("Handoff Receipt exceeds the 64 KiB limit.");
  }
  assertStrictJsonSyntax(source);

  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new Error("Handoff Receipt is not valid JSON.");
  }
  const receipt = requireRecord(parsed, "Handoff Receipt");
  requireExactKeys(
    receipt,
    [
      "schemaVersion",
      "type",
      "primaryType",
      "domain",
      "types",
      "message",
      "signer",
      "signature",
      "verificationMethod",
      "signatureValidation",
      "verifiedAt",
      "verification",
      "verificationUrl"
    ],
    "Handoff Receipt"
  );
  if (receipt.schemaVersion !== 1) {
    throw new Error("Unsupported Receipt version.");
  }
  if (receipt.type !== "BaseStampHandoffReceipt") {
    throw new Error("Unsupported Receipt type.");
  }
  if (receipt.primaryType !== HANDOFF_PRIMARY_TYPE) {
    throw new Error("Unsupported Receipt primary type.");
  }

  const domain = requireRecord(receipt.domain, "Receipt domain");
  requireExactKeys(
    domain,
    ["name", "version", "chainId", "verifyingContract"],
    "Receipt domain"
  );
  const chainId = requireSupportedChainId(domain.chainId, "Receipt chain ID");
  const deployment = getDeployment(chainId);
  const verifyingContract = requireAddress(
    domain.verifyingContract,
    "Receipt verifying contract"
  );
  if (
    domain.name !== "BaseStamp" ||
    domain.version !== "1" ||
    !isAddressEqual(verifyingContract, deployment.registryAddress)
  ) {
    throw new Error("Receipt domain does not match the approved deployment.");
  }

  const types = requireRecord(receipt.types, "Receipt types");
  requireExactKeys(types, ["EIP712Domain", "HandoffReceipt"], "Receipt types");
  requireTypeFields(
    types.EIP712Domain,
    HANDOFF_EIP712_DOMAIN_FIELDS,
    "Receipt EIP712Domain fields"
  );
  requireTypeFields(
    types.HandoffReceipt,
    HANDOFF_MESSAGE_FIELDS,
    "Receipt HandoffReceipt fields"
  );

  const message = requireRecord(receipt.message, "Receipt message");
  requireExactKeys(
    message,
    [
      "statement",
      "version",
      "stampId",
      "contentCommitment",
      "ackNonce",
      "issuedAt",
      "challengeExpiresAt"
    ],
    "Receipt message"
  );
  if (message.statement !== HANDOFF_STATEMENT || message.version !== 1) {
    throw new Error("Receipt statement or version is not supported.");
  }
  const stampId = requireBytes32(message.stampId, "Receipt stamp ID");
  const contentCommitment = requireBytes32(
    message.contentCommitment,
    "Receipt content commitment"
  );
  const ackNonce = requireBytes32(
    message.ackNonce,
    "Receipt acknowledgement nonce"
  );
  const issuedAt = requireInteger(message.issuedAt, "Receipt issued-at", 1);
  const challengeExpiresAt = requireInteger(
    message.challengeExpiresAt,
    "Receipt challenge expiry",
    issuedAt + 1,
    issuedAt + HANDOFF_CHALLENGE_TTL_SECONDS
  );

  const signer = requireAddress(receipt.signer, "Receipt signer");
  const signature = requireSignature(receipt.signature);
  if (receipt.verificationMethod !== "EIP-712") {
    throw new Error("Unsupported Receipt verification method.");
  }
  if (
    receipt.signatureValidation !== "eoa" &&
    receipt.signatureValidation !== "erc1271" &&
    receipt.signatureValidation !== "erc6492"
  ) {
    throw new Error("Unsupported Receipt signature validation method.");
  }
  const verifiedAt = requireTimestamp(receipt.verifiedAt, "Receipt verified-at");

  const verification = requireRecord(
    receipt.verification,
    "Receipt verification"
  );
  requireExactKeys(
    verification,
    ["blockNumber", "blockHash", "blockTimestamp"],
    "Receipt verification"
  );
  const blockNumber = requireInteger(
    verification.blockNumber,
    "Receipt block number",
    Number(deployment.deploymentBlock)
  );
  const blockHash = requireBytes32(
    verification.blockHash,
    "Receipt block hash"
  );
  const blockTimestamp = requireTimestamp(
    verification.blockTimestamp,
    "Receipt block timestamp"
  );

  const verificationUrl = requireString(
    receipt.verificationUrl,
    "Receipt verification URL"
  );
  const parsedUrl = new URL(verificationUrl);
  const chainAwarePath = createHandoffPath(chainId, stampId);
  const legacySepoliaPath = "/handoff/" + stampId;
  if (
    parsedUrl.origin !== expectedOrigin ||
    (parsedUrl.pathname !== chainAwarePath &&
      !(
        chainId === BASE_SEPOLIA_DEPLOYMENT.chainId &&
        parsedUrl.pathname === legacySepoliaPath
      )) ||
    parsedUrl.search !== "" ||
    parsedUrl.hash !== ""
  ) {
    throw new Error("Receipt verification URL does not match this deployment.");
  }

  return {
    schemaVersion: 1,
    type: "BaseStampHandoffReceipt",
    primaryType: HANDOFF_PRIMARY_TYPE,
    domain: createHandoffDomain(chainId),
    types: HANDOFF_RECEIPT_TYPES,
    message: {
      statement: HANDOFF_STATEMENT,
      version: 1,
      stampId,
      contentCommitment,
      ackNonce,
      issuedAt,
      challengeExpiresAt
    },
    signer,
    signature,
    verificationMethod: "EIP-712",
    signatureValidation: receipt.signatureValidation,
    verifiedAt,
    verification: { blockNumber, blockHash, blockTimestamp },
    verificationUrl
  };
}
