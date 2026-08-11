import { describe, expect, it } from "vitest";
import {
  createBaseSiweCapability,
  readBaseSiweResponse,
  readConnectedAddress,
  SIWE_STATEMENT,
  type NonceResponse
} from "../src/auth-client";

const address = "0x1111111111111111111111111111111111111111";
const nonce: NonceResponse = {
  nonce: "12345678",
  domain: "basestamp.example",
  uri: "https://basestamp.example",
  chainId: 84_532,
  issuedAt: "2026-08-11T00:00:00.000Z",
  expirationTime: "2026-08-11T00:10:00.000Z"
};

describe("Base Account SIWE client", () => {
  it("builds the wallet_connect capability from the server nonce", () => {
    expect(createBaseSiweCapability(nonce)).toEqual({
      nonce: "12345678",
      chainId: "0x14a34",
      domain: "basestamp.example",
      uri: "https://basestamp.example",
      version: "1",
      issuedAt: "2026-08-11T00:00:00.000Z",
      expirationTime: "2026-08-11T00:10:00.000Z",
      statement: SIWE_STATEMENT
    });
  });

  it("reads the signed SIWE capability returned by Base Account", () => {
    expect(
      readBaseSiweResponse({
        accounts: [
          {
            address,
            capabilities: {
              signInWithEthereum: {
                message: "basestamp.example wants you to sign in",
                signature: "0x1234"
              }
            }
          }
        ]
      })
    ).toEqual({
      address,
      signedMessage: {
        message: "basestamp.example wants you to sign in",
        signature: "0x1234"
      }
    });
  });

  it("fails closed for malformed capability data", () => {
    expect(
      readBaseSiweResponse({
        accounts: [
          {
            address,
            capabilities: {
              signInWithEthereum: { message: "message", signature: "bad" }
            }
          }
        ]
      })
    ).toBeUndefined();
    expect(readBaseSiweResponse({ accounts: [address] })).toBeUndefined();
  });

  it("normalizes addresses from both wagmi connection shapes", () => {
    expect(readConnectedAddress({ accounts: [address] })).toBe(address);
    expect(readConnectedAddress({ accounts: [{ address }] })).toBe(address);
    expect(readConnectedAddress({ accounts: ["invalid"] })).toBeUndefined();
  });
});
