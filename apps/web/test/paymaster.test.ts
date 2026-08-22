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
const BUILDER_SUFFIX = Attribution.toDataSuffix({ codes: [BUILDER_CODE] });
const CLAIM_ID = "65e41858-cd5e-4c75-b9e4-9a772d748949";
const GRANT_TOKEN = "g".repeat(43);
const PAYMASTER_AND_DATA = `0x${"11".repeat(20)}`;
const SAFE_PNG_ICON =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk" +
  "+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const SENDER = "0x1111111111111111111111111111111111111111" as Address;
const SPONSOR_SECRET = "i".repeat(32);
const env = {
  BASE_BUILDER_CODE: BUILDER_CODE,
  CDP_PAYMASTER_URL: "https://api.developer.coinbase.com/rpc/v1/base-sepolia/example",
  SPONSOR_ENABLED: "true",
  SPONSOR_ID_HMAC_SECRET: SPONSOR_SECRET,
  SPONSOR_POLICY_VERSION: "2",
  TURNSTILE_ALLOWED_HOSTNAMES: "basestamp-web.ndun000.workers.dev",
  TURNSTILE_SECRET_KEY: "t".repeat(32)
} as unknown as Bindings;

function bytes32(byte: string): Hex {
  return `0x${byte.repeat(32)}`;
}

function createRequest(
  method: "pm_getPaymasterData" | "pm_getPaymasterStubData" =
    "pm_getPaymasterData"
) {
  const registryCall = encodeFunctionData({
    abi: registryAbi,
    functionName: "createStamp",
    args: [bytes32("11"), bytes32("22"), bytes32("33")]
  });

  return {
    jsonrpc: "2.0",
    id: 7,
    method,
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
              BASE_SEPOLIA_DEPLOYMENT.registryAddress,
              0n,
              registryCall
            ]
          }),
          BUILDER_SUFFIX
        ]),
        callGasLimit: method === "pm_getPaymasterData" ? "0x186a0" : "0x0",
        verificationGasLimit:
          method === "pm_getPaymasterData" ? "0x30d40" : "0x0",
        preVerificationGas:
          method === "pm_getPaymasterData" ? "0xc350" : "0x0",
        ...(method === "pm_getPaymasterData"
          ? {
              maxFeePerGas: "0x3b9aca00",
              maxPriorityFeePerGas: "0xf4240"
            }
          : {})
      },
      BASE_ACCOUNT_ENTRY_POINT,
      "0x14a34",
      { claimId: CLAIM_ID, grantToken: GRANT_TOKEN }
    ]
  };
}

async function createClaim(
  overrides: Partial<SponsorClaim> = {}
): Promise<SponsorClaim> {
  return {
    action: "sponsor_stamp",
    chainId: 84532,
    grantExpiresAt: NOW + 300,
    grantTokenHash: await sha256Hex(GRANT_TOKEN),
    grantWalletKey: await createWalletSponsorKey(
      SPONSOR_SECRET,
      84532,
      SENDER
    ),
    policyVersion: 2,
    providerResponseJson: null,
    requestFingerprintHash: null,
    status: "grant_issued",
    stubFingerprintHash: null,
    stubResponseJson: null,
    ...overrides
  };
}

function createRepository(
  claim: SponsorClaim,
  busyReservations = 0
) {
  const events: string[] = [];
  let current = claim;
  let remainingBusyReservations = busyReservations;
  let resumeStatus = claim.status === "sponsored" ? "sponsored" : "grant_issued";

  const repository: SponsorProxyRepository = {
    findClaim: () => Promise.resolve(current),
    reserve(reservation) {
      if (remainingBusyReservations > 0) {
        remainingBusyReservations -= 1;
        events.push("busy");
        return Promise.resolve(false);
      }

      events.push("reserve");
      resumeStatus = current.status === "sponsored" ? "sponsored" : "grant_issued";
      current = {
        ...current,
        requestFingerprintHash: reservation.fingerprintHash,
        status: "requested"
      };
      return Promise.resolve(true);
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
        status: resumeStatus,
        stubFingerprintHash: completion.fingerprintHash,
        stubResponseJson: completion.responseJson
      };
      return Promise.resolve();
    },
    release() {
      events.push("released");
      current = { ...current, status: resumeStatus };
      return Promise.resolve();
    }
  };
  return { events, repository };
}

describe("Paymaster proxy", () => {
  it("retries a busy claim reservation instead of treating concurrency as unavailable", async () => {
    const memory = createRepository(
      await createClaim(),
      1
    );
    let providerCalls = 0;

    const response = await proxyPaymasterRequest({
      accountVerifier: () => Promise.resolve(),
      env,
      now: NOW,
      provider: () => {
        providerCalls += 1;
        return Promise.resolve({
          jsonrpc: "2.0",
          id: 7,
          result: { paymasterAndData: PAYMASTER_AND_DATA }
        });
      },
      repository: memory.repository,
      request: createRequest()
    });

    expect(response).toEqual({
      id: 7,
      result: { paymasterAndData: PAYMASTER_AND_DATA }
    });
    expect(providerCalls).toBe(1);
    expect(memory.events).toEqual([
      "busy",
      "reserve",
      "sponsored"
    ]);
  });

  it("marks a valid final Paymaster response as sponsored", async () => {
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
          result: { paymasterAndData: PAYMASTER_AND_DATA }
        });
      },
      repository: memory.repository,
      request: createRequest()
    });

    expect(response).toEqual({
      id: 7,
      result: { paymasterAndData: PAYMASTER_AND_DATA }
    });
    expect(accountVerified).toBe(true);
    expect(memory.events).toEqual([
      "reserve",
      "sponsored"
    ]);
  });

  it("requeries the provider after sponsorship when only gas fields change", async () => {
    const memory = createRepository(await createClaim());
    const firstRequest = createRequest();

    await proxyPaymasterRequest({
      accountVerifier: () => Promise.resolve(),
      env,
      now: NOW,
      provider: () =>
        Promise.resolve({
          jsonrpc: "2.0",
          id: 7,
          result: { paymasterAndData: PAYMASTER_AND_DATA }
        }),
      repository: memory.repository,
      request: firstRequest
    });

    const replayRequest = createRequest();
    const replayUserOperation =
      replayRequest.params[0] as Record<string, unknown>;

    replayUserOperation.callGasLimit = "0x20000";
    replayUserOperation.preVerificationGas = "0xd000";

    let providerCalls = 0;
    let accountVerifierCalls = 0;

    const replayed = await proxyPaymasterRequest({
      accountVerifier: () => {
        accountVerifierCalls += 1;
        return Promise.resolve();
      },
      env,
      now: NOW,
      provider: () => {
        providerCalls += 1;
        return Promise.resolve({
          jsonrpc: "2.0",
          id: 7,
          result: { paymasterAndData: PAYMASTER_AND_DATA }
        });
      },
      repository: memory.repository,
      request: replayRequest
    });

    expect(replayed.result).toEqual({
      paymasterAndData: PAYMASTER_AND_DATA
    });
    expect(providerCalls).toBe(1);
    expect(accountVerifierCalls).toBe(0);
    expect(memory.events).toEqual([
      "reserve",
      "sponsored",
      "reserve",
      "sponsored"
    ]);
  });

  it("releases a temporary reservation after a provider transport failure", async () => {
    const memory = createRepository(await createClaim());
    await expect(proxyPaymasterRequest({
      accountVerifier: () => Promise.resolve(),
      env,
      now: NOW,
      provider: () => Promise.reject(new Error("network down")),
      repository: memory.repository,
      request: createRequest()
    })).rejects.toMatchObject({ code: "sponsor_provider_unavailable", status: 503 });
    expect(memory.events).toEqual([
      "reserve",
      "released"
    ]);
  });

  it("releases the reservation when paymasterAndData is shorter than an address", async () => {
    const memory = createRepository(await createClaim());
    await expect(proxyPaymasterRequest({
      accountVerifier: () => Promise.resolve(),
      env,
      now: NOW,
      provider: () => Promise.resolve({
        jsonrpc: "2.0",
        id: 7,
        result: { paymasterAndData: "0x1234" }
      }),
      repository: memory.repository,
      request: createRequest()
    })).rejects.toMatchObject({
      code: "sponsor_provider_unavailable",
      status: 503
    });
    expect(memory.events).toEqual([
      "reserve",
      "released"
    ]);
  });

  it("releases the reservation when paymasterAndData starts with the zero address", async () => {
    const memory = createRepository(await createClaim());
    await expect(proxyPaymasterRequest({
      accountVerifier: () => Promise.resolve(),
      env,
      now: NOW,
      provider: () => Promise.resolve({
        jsonrpc: "2.0",
        id: 7,
        result: { paymasterAndData: `0x${"00".repeat(20)}11` }
      }),
      repository: memory.repository,
      request: createRequest()
    })).rejects.toMatchObject({
      code: "sponsor_provider_unavailable",
      status: 503
    });
    expect(memory.events).toEqual([
      "reserve",
      "released"
    ]);
  });

  it("accepts safe RFC 2397 raster metadata on stub responses", async () => {
    const memory = createRepository(await createClaim());
    const response = await proxyPaymasterRequest({
      accountVerifier: () => Promise.resolve(),
      env,
      now: NOW,
      provider: () => Promise.resolve({
        jsonrpc: "2.0",
        id: 7,
        result: {
          paymasterAndData: PAYMASTER_AND_DATA,
          sponsor: { name: "BaseStamp", icon: SAFE_PNG_ICON }
        }
      }),
      repository: memory.repository,
      request: createRequest("pm_getPaymasterStubData")
    });
    expect(response.result).toEqual({
      paymasterAndData: PAYMASTER_AND_DATA,
      sponsor: { name: "BaseStamp", icon: SAFE_PNG_ICON }
    });
    expect(memory.events).toEqual([
      "reserve",
      "stub"
    ]);
  });

  it("drops remote, SVG, mislabeled, and oversized icons without breaking the stub", async () => {
    const unsafeIcons = [
      "https://example.com/sponsor.png",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "data:image/png;base64,PHN2Zz48L3N2Zz4=",
      "data:image/png;base64," + "iVBORw0KGgo".padEnd(16_000, "A")
    ];
    for (const icon of unsafeIcons) {
      const memory = createRepository(await createClaim());
      const response = await proxyPaymasterRequest({
        accountVerifier: () => Promise.resolve(),
        env,
        now: NOW,
        provider: () => Promise.resolve({
          jsonrpc: "2.0",
          id: 7,
          result: {
            paymasterAndData: PAYMASTER_AND_DATA,
            sponsor: { name: "BaseStamp", icon }
          }
        }),
        repository: memory.repository,
        request: createRequest("pm_getPaymasterStubData")
      });
      expect(response.result).toEqual({
        paymasterAndData: PAYMASTER_AND_DATA,
        sponsor: { name: "BaseStamp" }
      });
      expect(memory.events).toEqual([
        "reserve",
        "stub"
      ]);
    }
  });

  it("rejects stub-only metadata on final paymaster data responses", async () => {
    const memory = createRepository(await createClaim());
    await expect(proxyPaymasterRequest({
      accountVerifier: () => Promise.resolve(),
      env,
      now: NOW,
      provider: () => Promise.resolve({
        jsonrpc: "2.0",
        id: 7,
        result: {
          paymasterAndData: PAYMASTER_AND_DATA,
          sponsor: { name: "BaseStamp" }
        }
      }),
      repository: memory.repository,
      request: createRequest()
    })).rejects.toMatchObject({
      code: "sponsor_provider_unavailable",
      status: 503
    });
    expect(memory.events).toEqual([
      "reserve",
      "released"
    ]);
  });

  it(
    "releases a provider-rejected stub so the same claim can retry",
    async () => {
      const memory = createRepository(await createClaim());
      const request = createRequest("pm_getPaymasterStubData");
      let providerCalls = 0;
      const call = () => proxyPaymasterRequest({
        accountVerifier: () => Promise.resolve(),
        env,
        now: NOW,
        provider: () => {
          providerCalls += 1;
          return Promise.resolve(
            providerCalls === 1
              ? {
                  jsonrpc: "2.0",
                  id: 7,
                  error: {
                    code: -32000,
                    message: "denied",
                    secret: "must-not-leak"
                  }
                }
              : {
                  jsonrpc: "2.0",
                  id: 7,
                  result: {
                    isFinal: false,
                    paymasterAndData: PAYMASTER_AND_DATA
                  }
                }
          );
        },
        repository: memory.repository,
        request
      });

      await expect(call()).rejects.toMatchObject({
        code: "sponsor_provider_rejected",
        status: 403
      });
      await expect(call()).resolves.toMatchObject({
        result: { isFinal: false, paymasterAndData: PAYMASTER_AND_DATA }
      });
      expect(providerCalls).toBe(2);
      expect(memory.events).toEqual([
        "reserve",
        "released",
        "reserve",
        "stub"
      ]);
    }
  );

  it("rejects a bad grant before account verification or provider forwarding", async () => {
    const memory = createRepository(
      await createClaim({ grantTokenHash: "0".repeat(64) })
    );
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
      repository: memory.repository,
      request: createRequest()
    })).rejects.toMatchObject({ code: "sponsor_request_rejected", status: 403 });
    expect(externalCalls).toBe(0);
    expect(memory.events).toEqual([]);
  });

  it("caches a non-final stub response for the claim", async () => {
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
          result: { paymasterAndData: PAYMASTER_AND_DATA, isFinal: false }
        });
      },
      repository: memory.repository,
      request
    });
    await call();
    await call();
    expect(providerCalls).toBe(1);
    expect(memory.events).toEqual([
      "reserve",
      "stub"
    ]);
  });

});
