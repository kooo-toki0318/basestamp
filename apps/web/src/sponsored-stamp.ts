import { concatHex, encodeFunctionData, type Address, type Hex } from "viem";
import { BASE_SEPOLIA_DEPLOYMENT } from "./lib/deployment";
import { registryAbi } from "./lib/registry";
import type { SponsorGrantResponse } from "./lib/sponsor";

export type SponsoredStampCallArguments = {
  account: Address;
  builderDataSuffix: Hex;
  contentCommitment: Hex;
  grant: SponsorGrantResponse;
  metadataHash: Hex;
  origin: string;
  stampNonce: Hex;
};

export function createSponsoredStampCall(
  arguments_: SponsoredStampCallArguments
) {
  return {
    account: arguments_.account,
    chainId: BASE_SEPOLIA_DEPLOYMENT.chainId,
    calls: [
      {
        to: BASE_SEPOLIA_DEPLOYMENT.registryAddress,
        data: concatHex([
          encodeFunctionData({
            abi: registryAbi,
            functionName: "createStamp",
            args: [
              arguments_.contentCommitment,
              arguments_.metadataHash,
              arguments_.stampNonce
            ]
          }),
          arguments_.builderDataSuffix
        ])
      }
    ] as const,
    capabilities: {
      paymasterService: {
        context: {
          claimId: arguments_.grant.claimId,
          grantToken: arguments_.grant.grantToken
        },
        optional: false as const,
        url: new URL("/api/sponsor", arguments_.origin).href
      }
    },
    forceAtomic: true as const
  };
}
