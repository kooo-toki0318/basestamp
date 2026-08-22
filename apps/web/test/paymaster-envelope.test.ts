import { describe, expect, it } from "vitest";
import { BASE_ACCOUNT_ENTRY_POINT } from "../src/lib/base-account";
import { validatePaymasterEnvelope } from "../worker/paymaster-policy";

const CLAIM_ID = "65e41858-cd5e-4c75-b9e4-9a772d748949";
const GRANT_TOKEN = "g".repeat(43);
const SENDER = "0x1111111111111111111111111111111111111111";

function createRequest() {
  return {
    jsonrpc: "2.0",
    id: 7,
    method: "pm_getPaymasterStubData",
    params: [
      {
        sender: SENDER,
        nonce: "0x0",
        initCode: "0x",
        callData: "0xdeadbeef",
        callGasLimit: "0x0",
        verificationGasLimit: "0x0",
        preVerificationGas: "0x0",
        maxFeePerGas: "0x1",
        maxPriorityFeePerGas: "0x1",
        signature: "0x1234",
        paymasterAndData: "0x",
        futureWalletField: {
          supported: true
        }
      },
      BASE_ACCOUNT_ENTRY_POINT,
      "0x2105",
      {
        claimId: CLAIM_ID,
        grantToken: GRANT_TOKEN,
        walletContextField: "allowed"
      }
    ]
  };
}

function expectRejected(request: unknown): void {
  try {
    validatePaymasterEnvelope(request);
    throw new Error("Expected paymaster envelope to be rejected.");
  } catch (error) {
    expect(error).toMatchObject({
      code: "sponsor_request_rejected",
      status: 403
    });
  }
}

describe("Paymaster proxy envelope", () => {
  it("accepts wallet-managed UserOperation fields without decoding them", () => {
    const request = createRequest();
    const parsed = validatePaymasterEnvelope(request);

    expect(parsed).toMatchObject({
      chainId: 8453,
      context: {
        claimId: CLAIM_ID,
        grantToken: GRANT_TOKEN
      },
      id: 7,
      method: "pm_getPaymasterStubData",
      sender: SENDER
    });
    expect(parsed.raw).toBe(request);
  });

  it("still rejects unsupported chains", () => {
    const request = createRequest();
    request.params[2] = "0x1";
    expectRejected(request);
  });

  it("still requires a wallet-bound sender", () => {
    const request = createRequest();
    delete (request.params[0] as Record<string, unknown>).sender;
    expectRejected(request);
  });
});
