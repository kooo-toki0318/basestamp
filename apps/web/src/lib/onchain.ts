import {
  createPublicClient,
  http,
  isAddressEqual,
  parseEventLogs,
  type Hex,
  type PublicClient,
  type Transport
} from "viem";
import { base, baseSepolia } from "viem/chains";
import {
  BASE_MAINNET_DEPLOYMENT,
  BASE_SEPOLIA_DEPLOYMENT,
  getDeployment,
  type Deployment
} from "./deployment";
import { registryAbi, type RegistryStamp } from "./registry";
import {
  formatUnixSeconds,
  type VerificationPackage
} from "./verification-package";

export const baseSepoliaPublicClient: PublicClient<
  Transport,
  typeof baseSepolia
> = createPublicClient({
  chain: baseSepolia,
  transport: http(BASE_SEPOLIA_DEPLOYMENT.rpcUrl)
});

export const baseMainnetPublicClient: PublicClient<
  Transport,
  typeof base
> = createPublicClient({
  chain: base,
  transport: http(BASE_MAINNET_DEPLOYMENT.rpcUrl)
});

type DeploymentPublicClient =
  | typeof baseMainnetPublicClient
  | typeof baseSepoliaPublicClient;

export function getDeploymentPublicClient(
  chainId: number
): DeploymentPublicClient {
  if (chainId === BASE_MAINNET_DEPLOYMENT.chainId) {
    return baseMainnetPublicClient;
  }
  if (chainId === BASE_SEPOLIA_DEPLOYMENT.chainId) {
    return baseSepoliaPublicClient;
  }
  throw new Error("Unsupported BaseStamp deployment chain.");
}

export async function readRegistryStamp(
  stampId: Hex,
  deployment: Deployment = BASE_SEPOLIA_DEPLOYMENT
): Promise<RegistryStamp> {
  return getDeploymentPublicClient(deployment.chainId).readContract({
    address: deployment.registryAddress,
    abi: registryAbi,
    functionName: "getStamp",
    args: [stampId]
  });
}

export async function readRegistryStampAtBlock(
  stampId: Hex,
  blockNumber: bigint,
  deployment: Deployment = BASE_SEPOLIA_DEPLOYMENT
): Promise<RegistryStamp> {
  return getDeploymentPublicClient(deployment.chainId).readContract({
    address: deployment.registryAddress,
    abi: registryAbi,
    functionName: "getStamp",
    args: [stampId],
    blockNumber
  });
}

export async function verifyPackageOnchain(
  package_: VerificationPackage
): Promise<RegistryStamp> {
  const deployment = getDeployment(package_.chainId);
  const publicClient = getDeploymentPublicClient(deployment.chainId);
  const [stamp, receipt, transaction] = await Promise.all([
    readRegistryStamp(package_.stampId, deployment),
    publicClient.getTransactionReceipt({
      hash: package_.transactionHash
    }),
    publicClient.getTransaction({
      hash: package_.transactionHash
    })
  ]);

  if (receipt.status !== "success") {
    throw new Error("The package transaction did not succeed.");
  }
  if (
    transaction.to === null ||
    !isAddressEqual(
      transaction.to,
      deployment.registryAddress
    ) ||
    transaction.value !== 0n
  ) {
    throw new Error("The package transaction does not target the Registry.");
  }
  if (receipt.blockNumber !== BigInt(package_.blockNumber)) {
    throw new Error("Transaction receipt does not match the package block.");
  }

  const block = await publicClient.getBlock({
    blockNumber: receipt.blockNumber
  });
  if (block.hash !== package_.blockHash) {
    throw new Error("Canonical block hash does not match the package.");
  }
  if (formatUnixSeconds(block.timestamp) !== package_.blockTimestamp) {
    throw new Error("Block timestamp does not match the package.");
  }

  if (
    !isAddressEqual(stamp.creator, package_.creator) ||
    stamp.contentCommitment !== package_.commitment.contentCommitment ||
    stamp.metadataHash !== package_.metadataHash ||
    formatUnixSeconds(stamp.createdAt) !== package_.createdAt
  ) {
    throw new Error("Registry state does not match the package.");
  }

  const events = parseEventLogs({
    abi: registryAbi,
    eventName: "StampCreated",
    logs: receipt.logs,
    strict: true
  });
  const event = events.find(
    (candidate) => candidate.args.stampId === package_.stampId
  );
  if (
    event === undefined ||
    !isAddressEqual(event.args.creator, package_.creator) ||
    event.args.contentCommitment !== package_.commitment.contentCommitment ||
    event.args.metadataHash !== package_.metadataHash ||
    formatUnixSeconds(event.args.createdAt) !== package_.createdAt
  ) {
    throw new Error("StampCreated event does not match the package.");
  }

  return stamp;
}
