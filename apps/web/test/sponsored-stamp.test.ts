import { Attribution } from "ox/erc8021";
import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { BASE_SEPOLIA_DEPLOYMENT } from "../src/lib/deployment";
import { registryAbi } from "../src/lib/registry";
import { createSponsoredStampCall } from "../src/sponsored-stamp";

const CONTENT = `0x${"11".repeat(32)}` as const;
const METADATA = `0x${"22".repeat(32)}` as const;
const NONCE = `0x${"33".repeat(32)}` as const;
const BUILDER_CODE = "basestamp";
const BUILDER_SUFFIX = Attribution.toDataSuffix({ codes: [BUILDER_CODE] });

describe("sponsored stamp call", () => {
  it("pins one atomic Registry call and a non-optional local paymaster", () => {
    const request = createSponsoredStampCall({
      account: "0x1111111111111111111111111111111111111111",
      builderDataSuffix: BUILDER_SUFFIX,
      contentCommitment: CONTENT,
      grant: {
        claimId: "11111111-1111-4111-8111-111111111111",
        expiresAt: "2026-08-11T09:00:00Z",
        grantToken: "a".repeat(43)
      },
      metadataHash: METADATA,
      origin: "https://basestamp.example",
      stampNonce: NONCE
    });

    expect(request.chainId).toBe(84532);
    expect(request.forceAtomic).toBe(true);
    expect(request.calls).toHaveLength(1);
    expect(request.calls[0].to).toBe(
      BASE_SEPOLIA_DEPLOYMENT.registryAddress
    );
    expect(request.calls[0].data.endsWith(BUILDER_SUFFIX.slice(2))).toBe(true);
    expect(Attribution.fromData(request.calls[0].data)).toEqual({
      codes: [BUILDER_CODE],
      id: 0
    });
    const registryData = `0x${request.calls[0].data.slice(
      2,
      2 - BUILDER_SUFFIX.length
    )}` as const;
    expect(decodeFunctionData({
      abi: registryAbi,
      data: registryData
    })).toEqual({
      args: [CONTENT, METADATA, NONCE],
      functionName: "createStamp"
    });
    expect(request.capabilities.paymasterService).toEqual({
      context: {
        claimId: "11111111-1111-4111-8111-111111111111",
        grantToken: "a".repeat(43)
      },
      optional: false,
      url: "https://basestamp.example/api/sponsor"
    });
  });
});
