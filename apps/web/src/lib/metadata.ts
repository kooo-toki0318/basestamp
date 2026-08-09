import type { Hex } from "viem";
import { sha256Hex } from "./crypto";

export const CONTENT_TYPES = [
  "application/pdf",
  "text/plain",
  "image/png",
  "image/jpeg",
  "application/zip",
  "application/octet-stream"
] as const;

export const PURPOSES = [
  "deliverable",
  "release",
  "report",
  "specification",
  "meeting-record"
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];
export type Purpose = (typeof PURPOSES)[number];

export type StampMetadata = {
  contentType: ContentType;
  purpose: Purpose;
  schemaVersion: 1;
};

function isMember<T extends string>(
  value: unknown,
  values: readonly T[]
): value is T {
  return typeof value === "string" && values.some((item) => item === value);
}

export function validateMetadata(value: unknown): StampMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Metadata must be an object.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "contentType" ||
    keys[1] !== "purpose" ||
    keys[2] !== "schemaVersion"
  ) {
    throw new Error("Metadata contains unsupported fields.");
  }
  if (!isMember(record.contentType, CONTENT_TYPES)) {
    throw new Error("Unsupported content type.");
  }
  if (!isMember(record.purpose, PURPOSES)) {
    throw new Error("Unsupported purpose.");
  }
  if (record.schemaVersion !== 1) {
    throw new Error("Unsupported metadata schema version.");
  }
  return {
    contentType: record.contentType,
    purpose: record.purpose,
    schemaVersion: 1
  };
}

export function canonicalizeMetadata(metadata: StampMetadata): string {
  const valid = validateMetadata(metadata);
  return (
    "{" +
    "\"contentType\":" +
    JSON.stringify(valid.contentType) +
    ",\"purpose\":" +
    JSON.stringify(valid.purpose) +
    ",\"schemaVersion\":1}"
  );
}

export async function hashMetadata(metadata: StampMetadata): Promise<Hex> {
  return sha256Hex(new TextEncoder().encode(canonicalizeMetadata(metadata)));
}
