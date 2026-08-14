import { Attribution } from "ox/erc8021";
import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import {
  BASE_MAINNET_DEPLOYMENT,
  BASE_SEPOLIA_DEPLOYMENT
} from "../src/lib/deployment";
import { registryAbi } from "../src/lib/registry";
import { createSponsoredStampCall } from "../src/sponsored-stamp";

const CONTENT = `0x${"11".repeat(32)}` as const;
const METADATA = `0x${"22".repeat(32)}` as const;
const NONCE = `0x${"33".repeat(32)}` as const;
const BUILDER_CODE = "basestamp";
const BUILDER_SUFFIX = Attribution.toDataSuffix({ codes: [BUILDER_CODE] });

describe("sponsored stamp call", () => {
  it.each([BASE_MAINNET_DEPLOYMENT, BASE_SEPOLIA_DEPLOYMENT])(
    "pins one atomic Registry call and local paymaster on $network",
    (deployment) => {
      const request = createSponsoredStampCall({
        account: "0x1111111111111111111111111111111111111111",
        builderDataSuffix: BUILDER_SUFFIX,
        chainId: deployment.chainId,
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

      expect(request.chainId).toBe(deployment.chainId);
      expect(request.forceAtomic).toBe(true);
      expect(request.calls).toHaveLength(1);
      expect(request.calls[0].to).toBe(deployment.registryAddress);
      expect(
        request.capabilities.dataSuffix
      ).toEqual({
        value: BUILDER_SUFFIX,
        optional: false
      });
      expect(Attribution.fromData(request.calls[0].data)).toEqual({
        codes: [BUILDER_CODE],
        id: 0
      });

expect(
  decodeFunctionData({
    abi: registryAbi,
    data: request.calls[0].data
  })
).toEqual({
  args: [CONTENT, METADATA, NONCE],
  functionName: "createStamp"
});
      expect(
        decodeFunctionData({ abi: registryAbi, data: registryData })
      ).toEqual({
        args: [CONTENT, METADATA, NONCE],
        functionName: "createStamp"
      });
  expect(request.capabilities.paymasterService).toEqual({
  context: {
    claimId: "11111111-1111-4111-8111-111111111111",
    grantToken: "a".repeat(43)
  },
  optional: false,
  url:
    "https://basestamp.example/api/sponsor" +
    "?claimId=11111111-1111-4111-8111-111111111111" +
    `&grantToken=${"a".repeat(43)}`
});
    }
  );
});
