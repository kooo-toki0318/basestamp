import type { Address, Hex } from "viem";

export type Deployment = {
  network: "base-sepolia";
  chainId: 84532;
  registryAddress: Address;
  deploymentTransaction: Hex;
  deploymentBlock: bigint;
  explorerUrl: string;
  rpcUrl: string;
};

export const BASE_SEPOLIA_DEPLOYMENT: Deployment = {
  network: "base-sepolia",
  chainId: 84532,
  registryAddress: "0x6491b8FBB13f7ADa916dD81B0834B529285f4EdB",
  deploymentTransaction:
    "0x06e54d004389016a27271d8ba8523067244962057137342cb5437fc8e967809b",
  deploymentBlock: 44_999_837n,
  explorerUrl: "https://sepolia.basescan.org",
  rpcUrl: "https://sepolia.base.org"
};

export function getDeployment(chainId: number): Deployment {
  if (chainId !== BASE_SEPOLIA_DEPLOYMENT.chainId) {
    throw new Error("Unsupported BaseStamp deployment chain.");
  }
  return BASE_SEPOLIA_DEPLOYMENT;
}
