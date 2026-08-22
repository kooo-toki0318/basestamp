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
  baseAccountAbi
} from "../src/lib/base-account";
import { BASE_MAINNET_DEPLOYMENT } from "../src/lib/deployment";
import { registryAbi } from "../src/lib/registry";
import { sha256Hex } from "../worker/crypto";
import {
  proxyPaymasterRequest,
  type SponsorClaim,
  type SponsorProxyRepository
} from "../worker/paymaster";
import { validatePaymasterRequest } from "../worker/paymaster-policy";
import { createWalletSponsorKey } from "../worker/sponsor";
import type { Bindings } from "../worker/types";

const BUILDER_CODE = "basestamp";
const BUILDER_SUFFIX = Attribution.toDataSuffix({ codes: [BUILDER_CODE] });
const CLAIM_ID = "65e41858-cd5e-4c75-b9e4-9a772d748949";
const GRANT_TOKEN = "g".repeat(43);
const SENDER =
  "0x1111111111111111111111111111111111111111" as Address;
const SPONSOR_SECRET = "i".repeat(32);
const PAYMASTER_AND_DATA = `0x${"11".repeat(20)}`;
const NOW = 1_786_406_400;

function bytes32(byte: string): Hex {
  return `0x${byte.repeat(32)}`;
}

function mainnetRequest() {
  const registryCall = encodeFunctionData({
    abi: registryAbi,
    functionName: "createStamp",
    args: [bytes32("11"), bytes32("22"), bytes32("33")]
  });

  return {
    jsonrpc: "2.0",
    id: 77,
    method: "pm_getPaymasterData",
    params: [
      {
        sender: SENDER,
        nonce: "0x0",
        initCode: "0x",
        callData: concatHex([
          encodeFunctionData({
            abi: baseAccountAbi,
            functionName: "execute",
            args: [
              BASE_MAINNET_DEPLOYMENT.registryAddress,
              0n,
              registryCall
            ]
          }),
          BUILDER_SUFFIX
        ]),
        callGasLimit: "0x186a0",
        verificationGasLimit: "0x30d40",
        preVerificationGas: "0xc350",
        maxFeePerGas: "0x3b9aca00",
        maxPriorityFeePerGas: "0xf4240"
      },
      BASE_ACCOUNT_ENTRY_POINT,
      "0x2105",
      { claimId: CLAIM_ID, grantToken: GRANT_TOKEN }
    ]
  };
}

async function mainnetClaim(): Promise<SponsorClaim> {
  return {
    action: "sponsor_stamp",
    chainId: 8453,
    grantExpiresAt: NOW + 300,
    grantTokenHash: await sha256Hex(GRANT_TOKEN),
    grantWalletKey: await createWalletSponsorKey(
      SPONSOR_SECRET,
      8453,
      SENDER
    ),
    policyVersion: 3,
    providerResponseJson: null,
    requestFingerprintHash: null,
    status: "grant_issued",
    stubFingerprintHash: null,
    stubResponseJson: null
  };
}

function repositoryFor(claim: SponsorClaim): SponsorProxyRepository {
  return {
    completeSponsored: () => Promise.resolve(),
    completeStub: () => Promise.resolve(),
    deny: () => Promise.resolve(),
    findClaim: () => Promise.resolve(claim),
    release: () => Promise.resolve(),
    reserve: () => Promise.resolve(true)
  };
}

describe("Base Mainnet sponsorship", () => {
  it("accepts the canonical Mainnet ERC-7677 request", () => {
    const parsed = validatePaymasterRequest(
      mainnetRequest(),
      BUILDER_CODE
    );
    expect(parsed.chainId).toBe(8453);
    expect(parsed.sender).toBe(SENDER);
  });

  it("routes Mainnet only to the Mainnet CDP endpoint", async () => {
    const env = {
      BASE_BUILDER_CODE: BUILDER_CODE,
      CDP_PAYMASTER_URL:
        "https://api.developer.coinbase.com/rpc/v1/base-sepolia/test",
      CDP_PAYMASTER_URL_MAINNET:
        "https://api.developer.coinbase.com/rpc/v1/base/test",
      MAINNET_RPC_URL:
        "https://api.developer.coinbase.com/rpc/v1/base/node-test",
      SPONSOR_ENABLED: "true",
      SPONSOR_ID_HMAC_SECRET: SPONSOR_SECRET,
      SPONSOR_POLICY_VERSION: "3",
      TURNSTILE_ALLOWED_HOSTNAMES:
        "basestamp-web.ndun000.workers.dev",
      TURNSTILE_SECRET_KEY: "t".repeat(32)
    } as unknown as Bindings;

    let providerUrl = "";
    const response = await proxyPaymasterRequest({
      accountVerifier: () => Promise.resolve(),
      env,
      now: NOW,
      provider: (url) => {
        providerUrl = url;
        return Promise.resolve({
          jsonrpc: "2.0",
          id: 77,
          result: { paymasterAndData: PAYMASTER_AND_DATA }
        });
      },
      repository: repositoryFor(await mainnetClaim()),
      request: mainnetRequest()
    });

    expect(providerUrl).toContain("/rpc/v1/base/");
    expect(providerUrl).not.toContain("/base-sepolia/");
    expect(response.result.paymasterAndData).toBe(PAYMASTER_AND_DATA);
  });

  it("rejects an Ethereum-mainnet chain substitution", () => {
    const request = mainnetRequest();
    request.params[2] = "0x1";
    expect(() =>
      validatePaymasterRequest(request, BUILDER_CODE)
    ).toThrow();
  });
});
