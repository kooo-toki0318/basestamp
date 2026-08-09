import { bytesToHex } from "viem";
import { describe, expect, it } from "vitest";
import {
  bytes32ToBase64Url
} from "../src/lib/crypto";
import { BASE_SEPOLIA_DEPLOYMENT } from "../src/lib/deployment";
import { hashMetadata } from "../src/lib/metadata";
import { deriveStampId } from "../src/lib/registry";
import {
  MAX_PACKAGE_BYTES,
  parseVerificationPackage,
  serializeVerificationPackage,
  type VerificationPackage
} from "../src/lib/verification-package";

const contentSalt = Uint8Array.from({ length: 32 }, (_, index) => index);
const stampNonce = Uint8Array.from(
  { length: 32 },
  (_, index) => 255 - index
);

async function packageFixture(): Promise<VerificationPackage> {
  const metadata = {
    contentType: "application/pdf",
    purpose: "deliverable",
    schemaVersion: 1
  } as const;
  const metadataHash = await hashMetadata(metadata);
  const contentCommitment =
    "0x327a5f24a60bbad8803f573d2e4d71eb8c0266abdfd993e836fd03c7491c5ec1";
  const creator = "0x1111111111111111111111111111111111111111";
  const stampId = deriveStampId({
    chainId: BASE_SEPOLIA_DEPLOYMENT.chainId,
    registryAddress: BASE_SEPOLIA_DEPLOYMENT.registryAddress,
    creator,
    contentCommitment,
    metadataHash,
    stampNonce: bytesToHex(stampNonce)
  });
  return {
    schemaVersion: 1,
    type: "BaseStampVerificationPackage",
    app: "BaseStamp",
    network: "base-sepolia",
    chainId: 84532,
    contractAddress: BASE_SEPOLIA_DEPLOYMENT.registryAddress,
    stampId,
    transactionHash:
      "0x06e54d004389016a27271d8ba8523067244962057137342cb5437fc8e967809b",
    blockNumber: 44_999_837,
    blockHash:
      "0x0baf45ade66b2d2dba15a24d8790a1517036cb1b2f382be03627271f9f3e2796",
    blockTimestamp: "2026-08-03T14:39:22Z",
    creator,
    createdAt: "2026-08-03T14:39:22Z",
    commitment: {
      algorithm: "SHA-256",
      domain: "BaseStamp.Content.v1",
      fileSize: 5,
      contentSalt: bytes32ToBase64Url(contentSalt),
      contentCommitment
    },
    stampNonce: bytes32ToBase64Url(stampNonce),
    metadata,
    metadataHash,
    verificationUrl: "https://example.test/stamps/" + stampId
  };
}

describe("verification package", () => {
  it("round-trips a strict version 1 package", async () => {
    const fixture = await packageFixture();
    await expect(
      parseVerificationPackage(serializeVerificationPackage(fixture))
    ).resolves.toEqual(fixture);
  });

  it("rejects unknown, duplicate, and prototype keys", async () => {
    const fixture = await packageFixture();
    const withUnknown = JSON.stringify({ ...fixture, fileName: "secret.pdf" });
    await expect(parseVerificationPackage(withUnknown)).rejects.toThrow(
      "unsupported fields"
    );

    const duplicate =
      "{\"schemaVersion\":1,\"schemaVersion\":1}";
    await expect(parseVerificationPackage(duplicate)).rejects.toThrow(
      "duplicate"
    );

    const prototypeKey =
      "{\"__proto__\":{},\"schemaVersion\":1}";
    await expect(parseVerificationPackage(prototypeKey)).rejects.toThrow(
      "forbidden"
    );
  });

  it("rejects oversized input before parsing", async () => {
    const oversized = " ".repeat(MAX_PACKAGE_BYTES + 1);
    await expect(parseVerificationPackage(oversized)).rejects.toThrow(
      "64 KiB"
    );
  });

  it("rejects noncanonical numbers and metadata tampering", async () => {
    const fixture = await packageFixture();
    const source = serializeVerificationPackage(fixture);
    await expect(
      parseVerificationPackage(source.replace("\"chainId\": 84532", "\"chainId\": 84532.0"))
    ).rejects.toThrow("Non-canonical");

    const tampered = {
      ...fixture,
      metadata: { ...fixture.metadata, purpose: "report" as const }
    };
    await expect(
      parseVerificationPackage(JSON.stringify(tampered))
    ).rejects.toThrow("Metadata hash");
  });

  it("rejects contract and canonical stamp ID substitution", async () => {
    const fixture = await packageFixture();
    await expect(
      parseVerificationPackage(
        JSON.stringify({
          ...fixture,
          contractAddress: "0x0000000000000000000000000000000000000001"
        })
      )
    ).rejects.toThrow("approved deployment");

    await expect(
      parseVerificationPackage(
        JSON.stringify({
          ...fixture,
          stampId:
            "0x0000000000000000000000000000000000000000000000000000000000000001"
        })
      )
    ).rejects.toThrow("canonical derivation");
  });
});
