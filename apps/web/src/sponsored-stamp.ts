import { encodeFunctionData, type Address, type Hex } from "viem";
import { getDeployment } from "./lib/deployment";
import type { SupportedChainId } from "./lib/networks";
import { registryAbi } from "./lib/registry";
import type { SponsorGrantResponse } from "./lib/sponsor";

export type SponsoredStampCallArguments = {
  account: Address;
  builderDataSuffix: Hex;
  chainId: SupportedChainId;
  contentCommitment: Hex;
  grant: SponsorGrantResponse;
  metadataHash: Hex;
  origin: string;
  stampNonce: Hex;
};

export function createSponsoredStampCall(
  arguments_: SponsoredStampCallArguments
) {
  const deployment = getDeployment(arguments_.chainId);

  const paymasterUrl = new URL("/api/sponsor", arguments_.origin);
  paymasterUrl.searchParams.set("claimId", arguments_.grant.claimId);
  paymasterUrl.searchParams.set("grantToken", arguments_.grant.grantToken);

  return {
    account: arguments_.account,
    chainId: deployment.chainId,
    calls: [
      {
        to: deployment.registryAddress,
        data: encodeFunctionData({
          abi: registryAbi,
          functionName: "createStamp",
          args: [
            arguments_.contentCommitment,
            arguments_.metadataHash,
            arguments_.stampNonce
          ]
        })
      }
    ] as const,
    capabilities: {
      dataSuffix: {
        value: arguments_.builderDataSuffix,
        optional: false as const
      },
      paymasterService: {
        context: {
          claimId: arguments_.grant.claimId,
          grantToken: arguments_.grant.grantToken
        },
        optional: false as const,
        url: paymasterUrl.href
      }
    },
        forceAtomic: true as const
  };
}
