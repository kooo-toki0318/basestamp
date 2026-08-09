import { bytesToHex, hexToBytes, type Hex } from "viem";

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
export const CONTENT_DOMAIN = "BaseStamp.Content.v1";
export const BYTES32_HEX_PATTERN = /^0x[0-9a-f]{64}$/u;

const encoder = new TextEncoder();
const domainBytes = new Uint8Array([
  ...encoder.encode(CONTENT_DOMAIN),
  0
]);

function requireBytes32(value: Uint8Array, field: string): void {
  if (value.byteLength !== 32) {
    throw new Error(field + " must be exactly 32 bytes.");
  }
}

export function uint64BigEndian(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("File size must be a non-negative safe integer.");
  }

  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false);
  return bytes;
}

export async function sha256Hex(value: Uint8Array): Promise<Hex> {
  const input = new Uint8Array(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return bytesToHex(new Uint8Array(digest));
}

export async function computeContentCommitment(
  fileBytes: Uint8Array,
  contentSalt: Uint8Array
): Promise<Hex> {
  if (fileBytes.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new Error("File exceeds the 25 MiB limit.");
  }
  requireBytes32(contentSalt, "Content salt");

  const sizeBytes = uint64BigEndian(fileBytes.byteLength);
  const input = new Uint8Array(
    domainBytes.byteLength +
      sizeBytes.byteLength +
      fileBytes.byteLength +
      contentSalt.byteLength
  );
  let offset = 0;
  input.set(domainBytes, offset);
  offset += domainBytes.byteLength;
  input.set(sizeBytes, offset);
  offset += sizeBytes.byteLength;
  input.set(fileBytes, offset);
  offset += fileBytes.byteLength;
  input.set(contentSalt, offset);

  return sha256Hex(input);
}

export function randomBytes32(): Uint8Array {
  let value: Uint8Array;
  do {
    value = globalThis.crypto.getRandomValues(new Uint8Array(32));
  } while (value.every((byte) => byte === 0));
  return value;
}

export function bytes32ToBase64Url(value: Uint8Array): string {
  requireBytes32(value, "Value");
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return globalThis
    .btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function base64UrlToBytes32(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new Error("Value must be canonical unpadded base64url.");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=";
  let binary: string;
  try {
    binary = globalThis.atob(padded);
  } catch {
    throw new Error("Value must be valid base64url.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  requireBytes32(bytes, "Value");
  if (bytes32ToBase64Url(bytes) !== value) {
    throw new Error("Value must use canonical base64url encoding.");
  }
  return bytes;
}

export function hexToBytes32(value: Hex): Uint8Array {
  if (!BYTES32_HEX_PATTERN.test(value)) {
    throw new Error("Value must be lowercase bytes32 hex.");
  }
  const bytes = hexToBytes(value);
  requireBytes32(bytes, "Value");
  return bytes;
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
