import { Attribution } from "ox/erc8021";
import { describe, expect, it } from "vitest";
import {
  concatHex,
  encodeFunctionData,
  type Address,
  type Hex
} from "viem";
import {
  BASE_ACCOUNT_ENTRY_POINT,
  BASE_ACCOUNT_FACTORY,
  baseAccountAbi,
  baseAccountFactoryAbi
} from "../src/lib/base-account";
import { BASE_SEPOLIA_DEPLOYMENT } from "../src/lib/deployment";
import { registryAbi } from "../src/lib/registry";
import { validatePaymasterRequest } from "../worker/paymaster-policy";

const BUILDER_CODE = "basestamp";
const SENDER = "0x1111111111111111111111111111111111111111" as Address;
const OTHER_TARGET = "0x2222222222222222222222222222222222222222" as Address;

function repeatedByteHex(byte: string): Hex {
  return `0x${byte.repeat(32)}`;
}

const BYTES_32_A = repeatedByteHex("11");
const BYTES_32_B = repeatedByteHex("22");
const BYTES_32_C = repeatedByteHex("33");

function createRegistryCall(
  suffix = Attribution.toDataSuffix({ codes: [BUILDER_CODE] })
): Hex {
  return concatHex([
    encodeFunctionData({
      abi: registryAbi,
      functionName: "createStamp",
      args: [BYTES_32_A, BYTES_32_B, BYTES_32_C]
    }),
    suffix
  ]);
}

function createAccountCall(arguments_: {
  data?: Hex;
  target?: Address;
  value?: bigint;
} = {}): Hex {
  return encodeFunctionData({
    abi: baseAccountAbi,
    functionName: "execute",
    args: [
      arguments_.target ?? BASE_SEPOLIA_DEPLOYMENT.registryAddress,
      arguments_.value ?? 0n,
      arguments_.data ?? createRegistryCall()
    ]
  });
}

function createRequest(method: "pm_getPaymasterData" | "pm_getPaymasterStubData" = "pm_getPaymasterData") {
  return {
    jsonrpc: "2.0",
    id: 1,
    method,
    params: [
      {
        sender: SENDER,
        nonce: "0x0",
        initCode: "0x",
        callData: createAccountCall(),
        callGasLimit: method === "pm_getPaymasterData" ? "0x186a0" : "0x0",
        verificationGasLimit:
          method === "pm_getPaymasterData" ? "0x30d40" : "0x0",
        preVerificationGas: method === "pm_getPaymasterData" ? "0xc350" : "0x0",
        ...(method === "pm_getPaymasterData"
          ? { maxFeePerGas: "0x3b9aca00", maxPriorityFeePerGas: "0xf4240" }
          : {})
      },
      BASE_ACCOUNT_ENTRY_POINT,
      "0x14a34",
      {
        claimId: "65e41858-cd5e-4c75-b9e4-9a772d748949",
        grantToken: "g".repeat(43)
      }
    ]
  };
}

function expectRejected(request: unknown, builderCode = BUILDER_CODE): void {
  try {
    validatePaymasterRequest(request, builderCode);
    throw new Error("Expected sponsorship request to be rejected.");
  } catch (error) {
    expect(error).toMatchObject({
      code: "sponsor_request_rejected",
      status: 403
    });
  }
}

describe("Paymaster deep validation", () => {
  it("accepts the exact EntryPoint v0.6 single-call Registry operation", () => {
    const parsed = validatePaymasterRequest(createRequest(), BUILDER_CODE);
    expect(parsed.method).toBe("pm_getPaymasterData");
    expect(parsed.sender).toBe(SENDER);
    expect(parsed.counterfactualAccount).toBeNull();
    expect(parsed.call).toEqual({
      contentCommitment: BYTES_32_A,
      metadataHash: BYTES_32_B,
      stampNonce: BYTES_32_C
    });
  });

  it("accepts a canonical allowlisted Base Account counterfactual initCode", () => {
    const request = createRequest("pm_getPaymasterStubData");
    const factoryData = encodeFunctionData({
      abi: baseAccountFactoryAbi,
      functionName: "createAccount",
      args: [["0x1234"], 7n]
    });
    const userOperation = request.params[0] as Record<string, unknown>;
    userOperation.initCode = concatHex([BASE_ACCOUNT_FACTORY, factoryData]);

    const parsed = validatePaymasterRequest(request, BUILDER_CODE);
    expect(parsed.counterfactualAccount).toMatchObject({
      factoryData,
      nonce: 7n,
      owners: ["0x1234"]
    });
  });

  it.each([
    ["unsupported method", (request: ReturnType<typeof createRequest>) => {
      request.method = "eth_sendTransaction" as "pm_getPaymasterData";
    }],
    ["wrong EntryPoint", (request: ReturnType<typeof createRequest>) => {
      request.params[1] = OTHER_TARGET;
    }],
    ["wrong chain", (request: ReturnType<typeof createRequest>) => {
      request.params[2] = "0x1";
    }],
    ["extra UserOperation field", (request: ReturnType<typeof createRequest>) => {
      (request.params[0] as Record<string, unknown>).paymasterAndData = "0x1234";
    }],
    ["non-canonical quantity", (request: ReturnType<typeof createRequest>) => {
      (request.params[0] as Record<string, unknown>).nonce = "0x00";
    }],
    ["wrong factory", (request: ReturnType<typeof createRequest>) => {
      const userOperation = request.params[0] as Record<string, unknown>;
      userOperation.initCode = concatHex([OTHER_TARGET, "0x1234"]);
    }]
  ])("rejects %s before forwarding", (_label, mutate) => {
    const request = createRequest();
    mutate(request);
    expectRejected(request);
  });

  it("rejects batch execution", () => {
    const request = createRequest();
    const userOperation = request.params[0] as Record<string, unknown>;
    userOperation.callData = encodeFunctionData({
      abi: baseAccountAbi,
      functionName: "executeBatch",
      args: [[{
        target: BASE_SEPOLIA_DEPLOYMENT.registryAddress,
        value: 0n,
        data: createRegistryCall()
      }]]
    });
    expectRejected(request);
  });

  it.each([
    ["wrong target", createAccountCall({ target: OTHER_TARGET })],
    ["nonzero value", createAccountCall({ value: 1n })],
    ["missing Builder suffix", createAccountCall({
      data: encodeFunctionData({
        abi: registryAbi,
        functionName: "createStamp",
        args: [BYTES_32_A, BYTES_32_B, BYTES_32_C]
      })
    })],
    ["duplicate Builder suffix", createAccountCall({
      data: concatHex([
        createRegistryCall(),
        Attribution.toDataSuffix({ codes: [BUILDER_CODE] })
      ])
    })],
    ["different Builder suffix", createAccountCall({
      data: createRegistryCall(Attribution.toDataSuffix({ codes: ["other"] }))
    })]
  ])("rejects %s", (_label, callData) => {
    const request = createRequest();
    (request.params[0] as Record<string, unknown>).callData = callData;
    expectRejected(request);
  });

  it("rejects zero Registry arguments", () => {
    const zero = repeatedByteHex("00");
    const request = createRequest();
    const registryCall = concatHex([
      encodeFunctionData({
        abi: registryAbi,
        functionName: "createStamp",
        args: [zero, BYTES_32_B, BYTES_32_C]
      }),
      Attribution.toDataSuffix({ codes: [BUILDER_CODE] })
    ]);
    (request.params[0] as Record<string, unknown>).callData =
      createAccountCall({ data: registryCall });
    expectRejected(request);
  });

  it("fails closed when the Builder Code is not configured", () => {
    expectRejected(createRequest(), "");
  });
});
