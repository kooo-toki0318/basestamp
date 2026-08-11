import { describe, expect, it } from "vitest";
import { bytes32ToBase64Url } from "../src/lib/crypto";
import { BASE_SEPOLIA_DEPLOYMENT } from "../src/lib/deployment";
import {
  HANDOFF_PRIMARY_TYPE,
  HANDOFF_RECEIPT_TYPES,
  HANDOFF_STATEMENT,
  createHandoffDomain,
  createHandoffUrl,
  parseHandoffChallenge,
  parseHandoffFragment,
  parseHandoffReceipt,
  serializeHandoffReceipt,
  type HandoffReceipt
} from "../src/lib/handoff";

const stampId =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const contentCommitment =
  "0x2222222222222222222222222222222222222222222222222222222222222222";
const ackNonce =
  "0x3333333333333333333333333333333333333333333333333333333333333333";
const contentSalt = bytes32ToBase64Url(
  Uint8Array.from({ length: 32 }, (_, index) => index)
);

function receiptFixture(): HandoffReceipt {
  return {
    schemaVersion: 1,
    type: "BaseStampHandoffReceipt",
    primaryType: HANDOFF_PRIMARY_TYPE,
    domain: createHandoffDomain(),
    types: HANDOFF_RECEIPT_TYPES,
    message: {
      statement: HANDOFF_STATEMENT,
      version: 1,
      stampId,
      contentCommitment,
      ackNonce,
      issuedAt: 1_786_368_000,
      challengeExpiresAt: 1_786_368_600
    },
    signer: "0x1111111111111111111111111111111111111111",
    signature: "0x12",
    verificationMethod: "EIP-712",
    signatureValidation: "eoa",
    verifiedAt: "2026-08-10T00:01:00Z",
    verification: {
      blockNumber: Number(BASE_SEPOLIA_DEPLOYMENT.deploymentBlock),
      blockHash:
        "0x4444444444444444444444444444444444444444444444444444444444444444",
      blockTimestamp: "2026-08-10T00:00:30Z"
    },
    verificationUrl: "https://example.test/handoff/" + stampId
  };
}

describe("private handoff", () => {
  it("accepts only a canonical, single-key fragment", () => {
    expect(parseHandoffFragment("#k=" + contentSalt)).toHaveLength(32);
    expect(() =>
      parseHandoffFragment("#k=" + contentSalt + "&utm_source=x")
    ).toThrow("missing or invalid");
    expect(() => parseHandoffFragment("#K=" + contentSalt)).toThrow(
      "missing or invalid"
    );
  });

  it("creates a same-origin handoff URL with the key only in the fragment", () => {
    const result = createHandoffUrl(
      "https://example.test",
      stampId,
      contentSalt
    );
    const url = new URL(result);
    expect(url.pathname).toBe("/handoff/" + stampId);
    expect(url.search).toBe("");
    expect(url.hash).toBe("#k=" + contentSalt);
  });

  it("rejects a substituted or expired Worker challenge", () => {
    const challenge = {
      domain: createHandoffDomain(),
      types: {
        HandoffReceipt: HANDOFF_RECEIPT_TYPES.HandoffReceipt
      },
      primaryType: HANDOFF_PRIMARY_TYPE,
      message: {
        statement: HANDOFF_STATEMENT,
        version: 1,
        stampId,
        contentCommitment,
        ackNonce,
        issuedAt: 1_786_368_000,
        challengeExpiresAt: 1_786_368_600
      }
    };
    expect(
      parseHandoffChallenge(
        challenge,
        stampId,
        contentCommitment,
        1_786_368_100
      )
    ).toEqual(challenge);
    expect(() =>
      parseHandoffChallenge(
        {
          ...challenge,
          message: {
            ...challenge.message,
            contentCommitment: stampId
          }
        },
        stampId,
        contentCommitment,
        1_786_368_100
      )
    ).toThrow("does not match");
    expect(() =>
      parseHandoffChallenge(
        challenge,
        stampId,
        contentCommitment,
        1_786_368_601
      )
    ).toThrow("does not match");
  });

  it("round-trips a strict Receipt without including the comparison key", () => {
    const receipt = receiptFixture();
    const source = serializeHandoffReceipt(receipt);
    expect(source).not.toContain(contentSalt);
    expect(parseHandoffReceipt(source, "https://example.test")).toEqual(
      receipt
    );
  });

  it("rejects Receipt tampering, unknown fields, duplicate keys, and fragments", () => {
    const receipt = receiptFixture();
    expect(() =>
      parseHandoffReceipt(
        JSON.stringify({ ...receipt, contentSalt }),
        "https://example.test"
      )
    ).toThrow("unsupported fields");
    expect(() =>
      parseHandoffReceipt(
        serializeHandoffReceipt({
          ...receipt,
          verificationUrl: receipt.verificationUrl + "#k=" + contentSalt
        }),
        "https://example.test"
      )
    ).toThrow("does not match");
    expect(() =>
      parseHandoffReceipt(
        '{"schemaVersion":1,"schemaVersion":1}',
        "https://example.test"
      )
    ).toThrow("duplicate");
  });
});
