import { describe, expect, it } from "vitest";
import {
  base64UrlToBytes32,
  bytes32ToBase64Url,
  computeContentCommitment,
  constantTimeEqual,
  MAX_FILE_SIZE_BYTES,
  uint64BigEndian
} from "../src/lib/crypto";
import {
  canonicalizeMetadata,
  hashMetadata,
  validateMetadata
} from "../src/lib/metadata";

const vectorSalt = Uint8Array.from({ length: 32 }, (_, index) => index);

describe("content commitment", () => {
  it("matches the fixed v1 test vector", async () => {
    const commitment = await computeContentCommitment(
      new TextEncoder().encode("hello"),
      vectorSalt
    );
    expect(commitment).toBe(
      "0x327a5f24a60bbad8803f573d2e4d71eb8c0266abdfd993e836fd03c7491c5ec1"
    );
  });

  it("encodes file size as unsigned uint64 big-endian", () => {
    expect(Array.from(uint64BigEndian(0))).toEqual(Array(8).fill(0));
    expect(Array.from(uint64BigEndian(0x0102))).toEqual([
      0, 0, 0, 0, 0, 0, 1, 2
    ]);
    expect(() => uint64BigEndian(-1)).toThrow();
  });

  it("accepts the limit and rejects a byte over the limit", async () => {
    await expect(
      computeContentCommitment(new Uint8Array(MAX_FILE_SIZE_BYTES), vectorSalt)
    ).resolves.toMatch(/^0x[0-9a-f]{64}$/u);
    await expect(
      computeContentCommitment(
        new Uint8Array(MAX_FILE_SIZE_BYTES + 1),
        vectorSalt
      )
    ).rejects.toThrow("25 MiB");
  });

  it("uses canonical unpadded base64url for bytes32", () => {
    const encoded = bytes32ToBase64Url(vectorSalt);
    expect(encoded).toBe("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8");
    expect(base64UrlToBytes32(encoded)).toEqual(vectorSalt);
    expect(() => base64UrlToBytes32(encoded + "=")).toThrow();
  });

  it("compares equal-length byte arrays without early return", () => {
    expect(constantTimeEqual(vectorSalt, vectorSalt.slice())).toBe(true);
    const changed = vectorSalt.slice();
    changed[31] = 0;
    expect(constantTimeEqual(vectorSalt, changed)).toBe(false);
    expect(constantTimeEqual(vectorSalt, new Uint8Array(31))).toBe(false);
  });
});

describe("fixed metadata", () => {
  const metadata = {
    contentType: "application/pdf",
    purpose: "deliverable",
    schemaVersion: 1
  } as const;

  it("matches the canonical JSON and SHA-256 vectors", async () => {
    expect(canonicalizeMetadata(metadata)).toBe(
      "{\"contentType\":\"application/pdf\",\"purpose\":\"deliverable\",\"schemaVersion\":1}"
    );
    await expect(hashMetadata(metadata)).resolves.toBe(
      "0xf2bbdc4233ccdb1a95bd995d98d4f7d705f28d2bebf7bb28ce0533681ffe2820"
    );
  });

  it("rejects unknown keys and enum values", () => {
    expect(() =>
      validateMetadata({ ...metadata, fileName: "secret.pdf" })
    ).toThrow("unsupported fields");
    expect(() =>
      validateMetadata({ ...metadata, purpose: "free text" })
    ).toThrow("purpose");
  });
});
