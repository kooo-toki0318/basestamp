import {
  hexToBytes,
  type Chain,
  type PublicClient,
  type Transport
} from "viem";
import { constantTimeEqual } from "./crypto";
import {
  BASE_MAINNET_DEPLOYMENT,
  getDeployment,
  type Deployment
} from "./deployment";
import {
  HANDOFF_PRIMARY_TYPE,
  HANDOFF_TYPES,
  type HandoffReceipt
} from "./handoff";
import { verifyHandoffTypedDataSignature } from "./handoff-signature";
import {
  baseMainnetPublicClient,
  baseSepoliaPublicClient,
  readRegistryStampAtBlock
} from "./onchain";
import { formatUnixSeconds } from "./verification-package";

async function verifyHandoffReceiptWithClient<
  transport extends Transport,
  chain extends Chain | undefined
>(
  client: PublicClient<transport, chain>,
  deployment: Deployment,
  receipt: HandoffReceipt
): Promise<void> {
  const blockNumber = BigInt(receipt.verification.blockNumber);
  const [block, stamp] = await Promise.all([
    client.getBlock({ blockNumber }),
    readRegistryStampAtBlock(
      receipt.message.stampId,
      blockNumber,
      deployment
    )
  ]);

  if (
    block.hash !== receipt.verification.blockHash ||
    formatUnixSeconds(block.timestamp) !== receipt.verification.blockTimestamp
  ) {
    throw new Error("Receipt verification block is no longer canonical.");
  }

  if (
    !constantTimeEqual(
      hexToBytes(stamp.contentCommitment),
      hexToBytes(receipt.message.contentCommitment)
    )
  ) {
    throw new Error("Receipt commitment does not match the Registry.");
  }

  const result = await verifyHandoffTypedDataSignature(client, {
    signer: receipt.signer,
    challenge: {
      domain: receipt.domain,
      types: HANDOFF_TYPES,
      primaryType: HANDOFF_PRIMARY_TYPE,
      message: receipt.message
    },
    signature: receipt.signature,
    blockNumber
  });
  if (
    !result.valid ||
    result.signatureValidation !== receipt.signatureValidation
  ) {
    throw new Error("Receipt signature is invalid.");
  }
}

export async function verifyHandoffReceipt(
  receipt: HandoffReceipt
): Promise<void> {
  const deployment = getDeployment(receipt.domain.chainId);
  if (deployment.chainId === BASE_MAINNET_DEPLOYMENT.chainId) {
    await verifyHandoffReceiptWithClient(
      baseMainnetPublicClient,
      deployment,
      receipt
    );
    return;
  }
  await verifyHandoffReceiptWithClient(
    baseSepoliaPublicClient,
    deployment,
    receipt
  );
}
