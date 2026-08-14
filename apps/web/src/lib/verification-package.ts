import {
  bytesToHex,
  getAddress,
  isAddress,
  isAddressEqual,
  type Address,
  type Hex
} from "viem";
import {
  base64UrlToBytes32,
  BYTES32_HEX_PATTERN,
  CONTENT_DOMAIN,
  MAX_FILE_SIZE_BYTES
} from "./crypto";
import { getDeployment, type Deployment } from "./deployment";
import {
  hashMetadata,
  validateMetadata,
  type StampMetadata
} from "./metadata";
import { deriveStampId } from "./registry";

export const MAX_PACKAGE_BYTES = 64 * 1024;

export type VerificationPackage = {
  schemaVersion: 1;
  type: "BaseStampVerificationPackage";
  app: "BaseStamp";
  network: Deployment["network"];
  chainId: Deployment["chainId"];
  contractAddress: Address;
  stampId: Hex;
  transactionHash: Hex;
  blockNumber: number;
  blockHash: Hex;
  blockTimestamp: string;
  creator: Address;
  createdAt: string;
  commitment: {
    algorithm: "SHA-256";
    domain: "BaseStamp.Content.v1";
    fileSize: number;
    contentSalt: string;
    contentCommitment: Hex;
  };
  stampNonce: string;
  metadata: StampMetadata;
  metadataHash: Hex;
  verificationUrl: string;
};

const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);
const jsonStringEscapes = new Set(["\"", "\\", "/", "b", "f", "n", "r", "t"]);

class JsonSyntaxGuard {
  private index = 0;

  constructor(private readonly source: string) {}

  scan(): void {
    this.skipWhitespace();
    this.readValue();
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      throw new Error("JSON contains trailing data.");
    }
  }

  private readValue(): void {
    this.skipWhitespace();
    const character = this.source[this.index];
    if (character === "{") {
      this.readObject();
    } else if (character === "[") {
      this.readArray();
    } else if (character === "\"") {
      this.readString();
    } else if (character === "t") {
      this.readLiteral("true");
    } else if (character === "f") {
      this.readLiteral("false");
    } else if (character === "n") {
      this.readLiteral("null");
    } else {
      this.readNumber();
    }
  }

  private readObject(): void {
    this.index += 1;
    this.skipWhitespace();
    const keys = new Set<string>();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return;
    }

    while (this.index < this.source.length) {
      if (this.source[this.index] !== "\"") {
        throw new Error("Object keys must be JSON strings.");
      }
      const key = this.readString();
      if (forbiddenKeys.has(key)) {
        throw new Error("JSON contains a forbidden object key.");
      }
      if (keys.has(key)) {
        throw new Error("JSON contains a duplicate object key.");
      }
      keys.add(key);
      this.skipWhitespace();
      this.expect(":");
      this.readValue();
      this.skipWhitespace();
      if (this.source[this.index] === "}") {
        this.index += 1;
        return;
      }
      this.expect(",");
      this.skipWhitespace();
    }
    throw new Error("Unterminated JSON object.");
  }

  private readArray(): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return;
    }
    while (this.index < this.source.length) {
      this.readValue();
      this.skipWhitespace();
      if (this.source[this.index] === "]") {
        this.index += 1;
        return;
      }
      this.expect(",");
      this.skipWhitespace();
    }
    throw new Error("Unterminated JSON array.");
  }

  private readString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === "\"") {
        this.index += 1;
        return JSON.parse(this.source.slice(start, this.index)) as string;
      }
      if (character === "\\") {
        this.index += 1;
        const escape = this.source[this.index];
        if (escape === "u") {
          const digits = this.source.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(digits)) {
            throw new Error("Invalid JSON unicode escape.");
          }
          this.index += 5;
          continue;
        }
        if (escape === undefined || !jsonStringEscapes.has(escape)) {
          throw new Error("Invalid JSON escape.");
        }
        this.index += 1;
        continue;
      }
      if (character === undefined || character.charCodeAt(0) < 0x20) {
        throw new Error("Invalid JSON string.");
      }
      this.index += 1;
    }
    throw new Error("Unterminated JSON string.");
  }

  private readLiteral(literal: string): void {
    if (this.source.slice(this.index, this.index + literal.length) !== literal) {
      throw new Error("Invalid JSON literal.");
    }
    this.index += literal.length;
  }

  private readNumber(): void {
    const remaining = this.source.slice(this.index);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      remaining
    );
    const token = match?.[0];
    if (token === undefined) throw new Error("Invalid JSON value.");
    if (token.includes(".") || /[eE]/u.test(token)) {
      throw new Error("Non-canonical numeric encoding is not allowed.");
    }
    this.index += token.length;
  }

  private expect(character: string): void {
    if (this.source[this.index] !== character) {
      throw new Error("Invalid JSON syntax.");
    }
    this.index += 1;
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.source[this.index] ?? "")) this.index += 1;
  }
}

export function assertStrictJsonSyntax(source: string): void {
  new JsonSyntaxGuard(source).scan();
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
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
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(field + " contains unsupported fields.");
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(field + " must be a string.");
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

export function formatUnixSeconds(value: bigint): string {
  const milliseconds = Number(value * 1000n);
  if (!Number.isSafeInteger(milliseconds)) {
    throw new Error("Timestamp is outside the supported range.");
  }
  return new Date(milliseconds).toISOString().replace(".000Z", "Z");
}

export function serializeVerificationPackage(
  value: VerificationPackage
): string {
  return JSON.stringify(value, null, 2) + "\n";
}

export async function parseVerificationPackage(
  source: string,
  expectedDeployment?: Deployment
): Promise<VerificationPackage> {
  if (new TextEncoder().encode(source).byteLength > MAX_PACKAGE_BYTES) {
    throw new Error("Verification package exceeds the 64 KiB limit.");
  }
  assertStrictJsonSyntax(source);

  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new Error("Verification package is not valid JSON.");
  }
  const record = requireRecord(parsed, "Verification package");
  requireExactKeys(
    record,
    [
      "schemaVersion",
      "type",
      "app",
      "network",
      "chainId",
      "contractAddress",
      "stampId",
      "transactionHash",
      "blockNumber",
      "blockHash",
      "blockTimestamp",
      "creator",
      "createdAt",
      "commitment",
      "stampNonce",
      "metadata",
      "metadataHash",
      "verificationUrl"
    ],
    "Verification package"
  );

  if (record.schemaVersion !== 1) throw new Error("Unsupported package version.");
  if (record.type !== "BaseStampVerificationPackage") {
    throw new Error("Unsupported package type.");
  }
  if (record.app !== "BaseStamp") throw new Error("Unsupported package app.");
  const packageChainId = requireInteger(record.chainId, "Chain ID", 1);
  let deployment: Deployment;
  try {
    deployment = expectedDeployment ?? getDeployment(packageChainId);
  } catch {
    throw new Error("Package chain does not match an approved deployment.");
  }
  if (record.network !== deployment.network) {
    throw new Error("Package network does not match the approved deployment.");
  }
  if (record.chainId !== deployment.chainId) {
    throw new Error("Package chain does not match the approved deployment.");
  }

  const contractAddress = requireAddress(
    record.contractAddress,
    "Contract address"
  );
  if (!isAddressEqual(contractAddress, deployment.registryAddress)) {
    throw new Error("Package contract does not match the approved deployment.");
  }

  const stampId = requireBytes32(record.stampId, "Stamp ID");
  const transactionHash = requireBytes32(
    record.transactionHash,
    "Transaction hash"
  );
  const blockHash = requireBytes32(record.blockHash, "Block hash");
  const creator = requireAddress(record.creator, "Creator");
  const metadataHash = requireBytes32(record.metadataHash, "Metadata hash");
  const blockNumber = requireInteger(record.blockNumber, "Block number", 1);
  const blockTimestamp = requireTimestamp(
    record.blockTimestamp,
    "Block timestamp"
  );
  const createdAt = requireTimestamp(record.createdAt, "Created at");
  const verificationUrl = requireString(
    record.verificationUrl,
    "Verification URL"
  );

  const commitmentRecord = requireRecord(record.commitment, "Commitment");
  requireExactKeys(
    commitmentRecord,
    [
      "algorithm",
      "domain",
      "fileSize",
      "contentSalt",
      "contentCommitment"
    ],
    "Commitment"
  );
  if (commitmentRecord.algorithm !== "SHA-256") {
    throw new Error("Unsupported commitment algorithm.");
  }
  if (commitmentRecord.domain !== CONTENT_DOMAIN) {
    throw new Error("Unsupported commitment domain.");
  }
  const fileSize = requireInteger(
    commitmentRecord.fileSize,
    "File size",
    0,
    MAX_FILE_SIZE_BYTES
  );
  const contentSalt = requireString(
    commitmentRecord.contentSalt,
    "Content salt"
  );
  base64UrlToBytes32(contentSalt);
  const contentCommitment = requireBytes32(
    commitmentRecord.contentCommitment,
    "Content commitment"
  );

  const stampNonce = requireString(record.stampNonce, "Stamp nonce");
  const stampNonceBytes = base64UrlToBytes32(stampNonce);
  const metadata = validateMetadata(record.metadata);
  const calculatedMetadataHash = await hashMetadata(metadata);
  if (calculatedMetadataHash !== metadataHash) {
    throw new Error("Metadata hash does not match canonical metadata.");
  }

  const calculatedStampId = deriveStampId({
    chainId: deployment.chainId,
    registryAddress: deployment.registryAddress,
    creator,
    contentCommitment,
    metadataHash,
    stampNonce: bytesToHex(stampNonceBytes)
  });
  if (calculatedStampId !== stampId) {
    throw new Error("Stamp ID does not match the canonical derivation.");
  }

  return {
    schemaVersion: 1,
    type: "BaseStampVerificationPackage",
    app: "BaseStamp",
    network: deployment.network,
    chainId: deployment.chainId,
    contractAddress,
    stampId,
    transactionHash,
    blockNumber,
    blockHash,
    blockTimestamp,
    creator,
    createdAt,
    commitment: {
      algorithm: "SHA-256",
      domain: "BaseStamp.Content.v1",
      fileSize,
      contentSalt,
      contentCommitment
    },
    stampNonce,
    metadata,
    metadataHash,
    verificationUrl
  };
}
