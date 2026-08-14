import type { Address, Hex } from "viem";

export type Deployment = {
  network: "base-mainnet" | "base-sepolia";
  chainId: 8453 | 84532;
  registryAddress: Address;
  deploymentTransaction: Hex;
  deploymentBlock: bigint;
  explorerUrl: string;
  rpcUrl: string;
};

export const BASE_SEPOLIA_DEPLOYMENT = {
  network: "base-sepolia",
  chainId: 84532,
  registryAddress: "0x6491b8FBB13f7ADa916dD81B0834B529285f4EdB",
  deploymentTransaction:
    "0x06e54d004389016a27271d8ba8523067244962057137342cb5437fc8e967809b",
  deploymentBlock: 44_999_837n,
  explorerUrl: "https://sepolia.basescan.org",
  rpcUrl: "https://sepolia.base.org"
} as const satisfies Deployment;

export const BASE_MAINNET_DEPLOYMENT = {
  network: "base-mainnet",
  chainId: 8453,
  registryAddress: "0x6491b8FBB13f7ADa916dD81B0834B529285f4EdB",
  deploymentTransaction:
    "0xa7078def113cadf25d0930ff8889fbd2d96112a805281e9cf3be38f06744ae84",
  deploymentBlock: 49_918_391n,
  explorerUrl: "https://basescan.org",
  rpcUrl: "https://mainnet.base.org"
} as const satisfies Deployment;

export function getDeployment(chainId: number): Deployment {
  if (chainId === BASE_MAINNET_DEPLOYMENT.chainId) {
    return BASE_MAINNET_DEPLOYMENT;
  }
  if (chainId === BASE_SEPOLIA_DEPLOYMENT.chainId) {
    return BASE_SEPOLIA_DEPLOYMENT;
  }
  throw new Error("Unsupported BaseStamp deployment chain.");
}
