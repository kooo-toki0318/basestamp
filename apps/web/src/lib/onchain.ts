import {
  createPublicClient,
  http,
  isAddressEqual,
  parseEventLogs,
  type Hex,
  type PublicClient,
  type Transport
} from "viem";
import { baseSepolia } from "viem/chains";
import { BASE_SEPOLIA_DEPLOYMENT } from "./deployment";
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

export async function readRegistryStamp(stampId: Hex): Promise<RegistryStamp> {
  return baseSepoliaPublicClient.readContract({
    address: BASE_SEPOLIA_DEPLOYMENT.registryAddress,
    abi: registryAbi,
    functionName: "getStamp",
    args: [stampId]
  });
}

export async function verifyPackageOnchain(
  package_: VerificationPackage
): Promise<RegistryStamp> {
  const [stamp, receipt, transaction] = await Promise.all([
    readRegistryStamp(package_.stampId),
    baseSepoliaPublicClient.getTransactionReceipt({
      hash: package_.transactionHash
    }),
    baseSepoliaPublicClient.getTransaction({
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
      BASE_SEPOLIA_DEPLOYMENT.registryAddress
    ) ||
    transaction.value !== 0n
  ) {
    throw new Error("The package transaction does not target the Registry.");
  }
  if (receipt.blockNumber !== BigInt(package_.blockNumber)) {
    throw new Error("Transaction receipt does not match the package block.");
  }

  const block = await baseSepoliaPublicClient.getBlock({
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
