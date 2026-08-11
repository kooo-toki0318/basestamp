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
import { BASE_SEPOLIA_DEPLOYMENT } from "../src/lib/deployment";
import { registryAbi } from "../src/lib/registry";
import { sha256Hex } from "../worker/crypto";
import {
  proxyPaymasterRequest,
  type SponsorClaim,
  type SponsorProxyRepository
} from "../worker/paymaster";
import { createWalletSponsorKey } from "../worker/sponsor";
import type { Bindings } from "../worker/types";

const NOW = 1_786_406_400;
const BUILDER_CODE = "basestamp";
const CLAIM_ID = "65e41858-cd5e-4c75-b9e4-9a772d748949";
const GRANT_TOKEN = "g".repeat(43);
const SENDER = "0x1111111111111111111111111111111111111111" as Address;
const SPONSOR_SECRET = "i".repeat(32);
const env = {
  BASE_BUILDER_CODE: BUILDER_CODE,
  CDP_PAYMASTER_URL: "https://api.developer.coinbase.com/rpc/v1/base-sepolia/example",
  IP_BUCKET_HMAC_SECRET: "p".repeat(32),
  SPONSOR_ENABLED: "true",
  SPONSOR_ID_HMAC_SECRET: SPONSOR_SECRET,
  SPONSOR_POLICY_VERSION: "1",
  TURNSTILE_ALLOWED_HOSTNAMES: "basestamp-web.ndun000.workers.dev",
  TURNSTILE_SECRET_KEY: "t".repeat(32)
} as unknown as Bindings;

function bytes32(byte: string): Hex {
  return `0x${byte.repeat(32)}`;
}

function createRequest(method: "pm_getPaymasterData" | "pm_getPaymasterStubData" = "pm_getPaymasterData") {
  const registryCall = concatHex([
    encodeFunctionData({
      abi: registryAbi,
      functionName: "createStamp",
      args: [bytes32("11"), bytes32("22"), bytes32("33")]
    }),
    Attribution.toDataSuffix({ codes: [BUILDER_CODE] })
  ]);
  return {
    jsonrpc: "2.0",
    id: 7,
    method,
    params: [
      {
        sender: SENDER,
        nonce: "0x0",
        initCode: "0x",
        callData: encodeFunctionData({
          abi: baseAccountAbi,
          functionName: "execute",
          args: [BASE_SEPOLIA_DEPLOYMENT.registryAddress, 0n, registryCall]
        }),
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
      { claimId: CLAIM_ID, grantToken: GRANT_TOKEN }
    ]
  };
}

async function createClaim(overrides: Partial<SponsorClaim> = {}): Promise<SponsorClaim> {
  return {
    action: "sponsor_stamp",
    chainId: 84532,
    grantExpiresAt: NOW + 300,
    grantTokenHash: await sha256Hex(GRANT_TOKEN),
    grantWalletKey: await createWalletSponsorKey(SPONSOR_SECRET, 84532, SENDER),
    policyVersion: 1,
    providerResponseJson: null,
    requestFingerprintHash: null,
    status: "grant_issued",
    stubFingerprintHash: null,
    stubResponseJson: null,
    ...overrides
  };
}

function createRepository(claim: SponsorClaim, allowlisted = false) {
  const events: string[] = [];
  let current = claim;
  const repository: SponsorProxyRepository = {
    findClaim: () => Promise.resolve(current),
    isWalletLifetimeBypassed: () => Promise.resolve(allowlisted),
    reserve(reservation) {
      events.push(`reserve:${String(reservation.walletLifetimeBypassed)}`);
      current = {
        ...current,
        requestFingerprintHash: reservation.fingerprintHash,
        status: "requested"
      };
      return Promise.resolve();
    },
    completeSponsored(completion) {
      events.push("sponsored");
      current = {
        ...current,
        providerResponseJson: completion.responseJson,
        requestFingerprintHash: completion.fingerprintHash,
        status: "sponsored"
      };
      return Promise.resolve();
    },
    completeStub(completion) {
      events.push("stub");
      current = {
        ...current,
        requestFingerprintHash: null,
        status: "grant_issued",
        stubFingerprintHash: completion.fingerprintHash,
        stubResponseJson: completion.responseJson
      };
      return Promise.resolve();
    },
    deny() {
      events.push("denied");
      current = { ...current, status: "denied" };
      return Promise.resolve();
    },
    release() {
      events.push("released");
      current = { ...current, status: "grant_issued" };
      return Promise.resolve();
    }
  };
  return { events, repository };
}

describe("Paymaster proxy", () => {
  it("consumes the wallet slot only after a valid final provider response", async () => {
    const memory = createRepository(await createClaim());
    let accountVerified = false;
    const response = await proxyPaymasterRequest({
      accountVerifier: () => {
        accountVerified = true;
        return Promise.resolve();
      },
      env,
      now: NOW,
      provider: (url, payload) => {
        expect(url).toContain("api.developer.coinbase.com");
        const params = payload.params as unknown[];
        expect(params[3]).toEqual({});
        expect(JSON.stringify(payload)).not.toContain(GRANT_TOKEN);
        return Promise.resolve({
          jsonrpc: "2.0",
          id: 7,
          result: { paymasterAndData: "0x1234" }
        });
      },
      remoteIp: "203.0.113.10",
      repository: memory.repository,
      request: createRequest()
    });

    expect(response).toEqual({ id: 7, result: { paymasterAndData: "0x1234" } });
    expect(accountVerified).toBe(true);
    expect(memory.events).toEqual(["reserve:false", "sponsored"]);
  });

  it("returns a cached final response without reaching the account RPC or provider again", async () => {
    const firstMemory = createRepository(await createClaim());
    const request = createRequest();
    const provider = () => Promise.resolve({
      jsonrpc: "2.0",
      id: 7,
      result: { paymasterAndData: "0x1234" }
    });
    await proxyPaymasterRequest({
      accountVerifier: () => Promise.resolve(),
      env,
      now: NOW,
      provider,
      remoteIp: "203.0.113.10",
      repository: firstMemory.repository,
      request
    });
    let externalCalls = 0;
    const retried = await proxyPaymasterRequest({
      accountVerifier: () => {
        externalCalls += 1;
        return Promise.resolve();
      },
      env,
      now: NOW,
      provider: () => {
        externalCalls += 1;
        return Promise.resolve({});
      },
      remoteIp: "203.0.113.10",
      repository: firstMemory.repository,
      request
    });
    expect(retried.result).toEqual({ paymasterAndData: "0x1234" });
    expect(externalCalls).toBe(0);
  });

  it("releases a temporary reservation after a provider transport failure", async () => {
    const memory = createRepository(await createClaim());
    await expect(proxyPaymasterRequest({
      accountVerifier: () => Promise.resolve(),
      env,
      now: NOW,
      provider: () => Promise.reject(new Error("network down")),
      remoteIp: "203.0.113.10",
      repository: memory.repository,
      request: createRequest()
    })).rejects.toMatchObject({ code: "sponsor_provider_unavailable", status: 503 });
    expect(memory.events).toEqual(["reserve:false", "released"]);
  });

  it("makes an explicit provider denial terminal without consuming quota", async () => {
    const memory = createRepository(await createClaim());
    await expect(proxyPaymasterRequest({
      accountVerifier: () => Promise.resolve(),
      env,
      now: NOW,
      provider: () => Promise.resolve({
        jsonrpc: "2.0",
        id: 7,
        error: { code: -32000, message: "denied", secret: "must-not-leak" }
      }),
      remoteIp: "203.0.113.10",
      repository: memory.repository,
      request: createRequest()
    })).rejects.toMatchObject({ code: "sponsor_provider_rejected", status: 403 });
    expect(memory.events).toEqual(["reserve:false", "denied"]);
  });

  it("rejects a bad grant before account verification or provider forwarding", async () => {
    const memory = createRepository(await createClaim({ grantTokenHash: "0".repeat(64) }));
    let externalCalls = 0;
    await expect(proxyPaymasterRequest({
      accountVerifier: () => {
        externalCalls += 1;
        return Promise.resolve();
      },
      env,
      now: NOW,
      provider: () => {
        externalCalls += 1;
        return Promise.resolve({});
      },
      remoteIp: "203.0.113.10",
      repository: memory.repository,
      request: createRequest()
    })).rejects.toMatchObject({ code: "sponsor_request_rejected", status: 403 });
    expect(externalCalls).toBe(0);
    expect(memory.events).toEqual([]);
  });

  it("caches a non-final stub response without consuming the lifetime slot", async () => {
    const memory = createRepository(await createClaim());
    let providerCalls = 0;
    const request = createRequest("pm_getPaymasterStubData");
    const call = () => proxyPaymasterRequest({
      accountVerifier: () => Promise.resolve(),
      env,
      now: NOW,
      provider: () => {
        providerCalls += 1;
        return Promise.resolve({
          jsonrpc: "2.0",
          id: 7,
          result: { paymasterAndData: "0x1234", isFinal: false }
        });
      },
      remoteIp: "203.0.113.10",
      repository: memory.repository,
      request
    });
    await call();
    await call();
    expect(providerCalls).toBe(1);
    expect(memory.events).toEqual(["reserve:false", "stub"]);
  });

  it("marks a D1-allowlisted Sepolia wallet as lifetime-bypassed", async () => {
    const memory = createRepository(await createClaim(), true);
    await proxyPaymasterRequest({
      accountVerifier: () => Promise.resolve(),
      env,
      now: NOW,
      provider: () => Promise.resolve({
        jsonrpc: "2.0",
        id: 7,
        result: { paymasterAndData: "0x1234" }
      }),
      remoteIp: "203.0.113.10",
      repository: memory.repository,
      request: createRequest()
    });
    expect(memory.events).toEqual(["reserve:true", "sponsored"]);
  });
});
