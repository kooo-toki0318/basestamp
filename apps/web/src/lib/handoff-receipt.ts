import { hexToBytes } from "viem";
import { constantTimeEqual } from "./crypto";
import {
  HANDOFF_PRIMARY_TYPE,
  HANDOFF_TYPES,
  type HandoffReceipt
} from "./handoff";
import { verifyHandoffTypedDataSignature } from "./handoff-signature";
import {
  baseSepoliaPublicClient,
  readRegistryStampAtBlock
} from "./onchain";
import { formatUnixSeconds } from "./verification-package";

export async function verifyHandoffReceipt(
  receipt: HandoffReceipt
): Promise<void> {
  const blockNumber = BigInt(receipt.verification.blockNumber);
  const [block, stamp] = await Promise.all([
    baseSepoliaPublicClient.getBlock({ blockNumber }),
    readRegistryStampAtBlock(receipt.message.stampId, blockNumber)
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

  const result = await verifyHandoffTypedDataSignature(
    baseSepoliaPublicClient,
    {
      signer: receipt.signer,
      challenge: {
        domain: receipt.domain,
        types: HANDOFF_TYPES,
        primaryType: HANDOFF_PRIMARY_TYPE,
        message: receipt.message
      },
      signature: receipt.signature,
      blockNumber
    }
  );
  if (
    !result.valid ||
    result.signatureValidation !== receipt.signatureValidation
  ) {
    throw new Error("Receipt signature is invalid.");
  }
}
