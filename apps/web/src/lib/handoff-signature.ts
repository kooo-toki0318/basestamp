import {
  decodeAbiParameters,
  decodeFunctionData,
  isAddressEqual,
  keccak256,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport
} from "viem";
import {
  BASE_ACCOUNT_ERC6492_VALIDATOR,
  BASE_ACCOUNT_FACTORY,
  BASE_ACCOUNT_FACTORY_CODE_HASH,
  BASE_ACCOUNT_IMPLEMENTATION,
  BASE_ACCOUNT_IMPLEMENTATION_CODE_HASH,
  BASE_ACCOUNT_VALIDATOR_CODE_HASH,
  baseAccountFactoryAbi
} from "./base-account";
import {
  HANDOFF_PRIMARY_TYPE,
  HANDOFF_TYPES,
  type HandoffChallenge,
  type SignatureValidation
} from "./handoff";

const ERC6492_MAGIC =
  "6492649264926492649264926492649264926492649264926492649264926492";

export class UnsupportedCounterfactualSignatureError extends Error {}

function isErc6492Signature(signature: Hex): boolean {
  return signature.toLowerCase().endsWith(ERC6492_MAGIC);
}

async function requireCodeHash<
  transport extends Transport,
  chain extends Chain | undefined
>(
  client: PublicClient<transport, chain>,
  address: Address,
  expectedHash: Hex,
  blockNumber: bigint
): Promise<void> {
  const code = await client.getCode({ address, blockNumber });
  if (code === undefined || keccak256(code) !== expectedHash) {
    throw new UnsupportedCounterfactualSignatureError(
      "Counterfactual signature component is not on the approved Base Account release."
    );
  }
}

async function validateBaseAccountErc6492Envelope<
  transport extends Transport,
  chain extends Chain | undefined
>(
  client: PublicClient<transport, chain>,
  signer: Address,
  signature: Hex,
  blockNumber: bigint
): Promise<void> {
  const encodedEnvelope = (
    "0x" + signature.slice(2, -(ERC6492_MAGIC.length))
  ) as Hex;

  let factory: Address;
  let factoryData: Hex;
  try {
    [factory, factoryData] = decodeAbiParameters(
      [
        { name: "factory", type: "address" },
        { name: "factoryData", type: "bytes" },
        { name: "originalSignature", type: "bytes" }
      ],
      encodedEnvelope
    );
  } catch {
    throw new UnsupportedCounterfactualSignatureError(
      "Counterfactual signature envelope is malformed."
    );
  }

  if (!isAddressEqual(factory, BASE_ACCOUNT_FACTORY)) {
    throw new UnsupportedCounterfactualSignatureError(
      "Counterfactual signature factory is not allowlisted."
    );
  }

  let owners: readonly Hex[];
  let nonce: bigint;
  try {
    const decoded = decodeFunctionData({
      abi: baseAccountFactoryAbi,
      data: factoryData
    });
    if (decoded.functionName !== "createAccount") {
      throw new Error("Unsupported factory method.");
    }
    [owners, nonce] = decoded.args;
  } catch {
    throw new UnsupportedCounterfactualSignatureError(
      "Counterfactual signature factory call is not allowlisted."
    );
  }

  await Promise.all([
    requireCodeHash(
      client,
      BASE_ACCOUNT_FACTORY,
      BASE_ACCOUNT_FACTORY_CODE_HASH,
      blockNumber
    ),
    requireCodeHash(
      client,
      BASE_ACCOUNT_IMPLEMENTATION,
      BASE_ACCOUNT_IMPLEMENTATION_CODE_HASH,
      blockNumber
    ),
    requireCodeHash(
      client,
      BASE_ACCOUNT_ERC6492_VALIDATOR,
      BASE_ACCOUNT_VALIDATOR_CODE_HASH,
      blockNumber
    )
  ]);

  const [implementation, predictedAddress] = await Promise.all([
    client.readContract({
      address: BASE_ACCOUNT_FACTORY,
      abi: baseAccountFactoryAbi,
      functionName: "implementation",
      blockNumber
    }),
    client.readContract({
      address: BASE_ACCOUNT_FACTORY,
      abi: baseAccountFactoryAbi,
      functionName: "getAddress",
      args: [owners, nonce],
      blockNumber
    })
  ]);
  if (
    !isAddressEqual(implementation, BASE_ACCOUNT_IMPLEMENTATION) ||
    !isAddressEqual(predictedAddress, signer)
  ) {
    throw new UnsupportedCounterfactualSignatureError(
      "Counterfactual signature does not derive the approved Base Account."
    );
  }
}

export async function verifyHandoffTypedDataSignature<
  transport extends Transport,
  chain extends Chain | undefined
>(
  client: PublicClient<transport, chain>,
  arguments_: {
    signer: Address;
    challenge: HandoffChallenge;
    signature: Hex;
    blockNumber: bigint;
  }
): Promise<{ valid: boolean; signatureValidation: SignatureValidation }> {
  let signatureValidation: SignatureValidation;
  if (isErc6492Signature(arguments_.signature)) {
    signatureValidation = "erc6492";
    await validateBaseAccountErc6492Envelope(
      client,
      arguments_.signer,
      arguments_.signature,
      arguments_.blockNumber
    );
  } else {
    const code = await client.getCode({
      address: arguments_.signer,
      blockNumber: arguments_.blockNumber
    });
    signatureValidation =
      code === undefined || code === "0x" ? "eoa" : "erc1271";
  }

  const valid = await client.verifyTypedData({
    address: arguments_.signer,
    domain: arguments_.challenge.domain,
    types: HANDOFF_TYPES,
    primaryType: HANDOFF_PRIMARY_TYPE,
    message: arguments_.challenge.message,
    signature: arguments_.signature,
    blockNumber: arguments_.blockNumber
  });
  return { valid, signatureValidation };
}
