export const BASE_NETWORKS = [
  {
    chainId: 8453,
    name: "Base",
    environment: "Mainnet",
    registryAvailable: false
  },
  {
    chainId: 84532,
    name: "Base Sepolia",
    environment: "Testnet",
    registryAvailable: true
  }
] as const;

export type SupportedChainId = (typeof BASE_NETWORKS)[number]["chainId"];

export type BaseNetwork = (typeof BASE_NETWORKS)[number];

export function isSupportedChainId(value: number): value is SupportedChainId {
  return BASE_NETWORKS.some((network) => network.chainId === value);
}

export function getBaseNetwork(chainId: SupportedChainId): BaseNetwork {
  const network = BASE_NETWORKS.find(
    (candidate) => candidate.chainId === chainId
  );
  if (network === undefined) {
    throw new Error("Unsupported Base network.");
  }
  return network;
}

export function chainName(chainId: number | undefined): string {
  if (chainId === undefined) return "Not connected";
  if (isSupportedChainId(chainId)) return getBaseNetwork(chainId).name;
  return `Chain ${String(chainId)}`;
}
