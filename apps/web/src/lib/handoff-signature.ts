import {
  decodeAbiParameters,
  decodeFunctionData,
  getAddress,
  isAddressEqual,
  keccak256,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport
} from "viem";
import {
  HANDOFF_PRIMARY_TYPE,
  HANDOFF_TYPES,
  type HandoffChallenge,
  type SignatureValidation
} from "./handoff";

export const BASE_ACCOUNT_FACTORY = getAddress(
  "0xba5ed110efdba3d005bfc882d75358acbbb85842"
);
export const BASE_ACCOUNT_IMPLEMENTATION = getAddress(
  "0x00000110dCdEdC9581cb5eCB8467282f2926534d"
);
export const BASE_ACCOUNT_ERC6492_VALIDATOR = getAddress(
  "0xcfCE48B757601F3f351CB6f434CB0517aEEE293D"
);

const BASE_ACCOUNT_FACTORY_CODE_HASH =
  "0xb60a629aa7c6af9b550871fd21b67ab84638156683cec68491049cb5d235ed2f";
const BASE_ACCOUNT_IMPLEMENTATION_CODE_HASH =
  "0x136185896fc519277ec953c0b3d048fc0c9f607b8d04022e60f23ef8dbc6c4d5";
const BASE_ACCOUNT_VALIDATOR_CODE_HASH =
  "0x94a000eab18fdda0465241bd0e82487463fb2e539854a3645542e57ed8dde484";
const ERC6492_MAGIC =
  "6492649264926492649264926492649264926492649264926492649264926492";

const baseAccountFactoryAbi = [
  {
    type: "function",
    name: "createAccount",
    stateMutability: "payable",
    inputs: [
      { name: "owners", type: "bytes[]" },
      { name: "nonce", type: "uint256" }
    ],
    outputs: [{ name: "account", type: "address" }]
  },
  {
    type: "function",
    name: "getAddress",
    stateMutability: "view",
    inputs: [
      { name: "owners", type: "bytes[]" },
      { name: "nonce", type: "uint256" }
    ],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "implementation",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  }
] as const;

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
