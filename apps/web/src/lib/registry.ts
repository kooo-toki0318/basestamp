import {
  encodeAbiParameters,
  keccak256,
  type Address,
  type Hex
} from "viem";

export const registryAbi = [
  {
    type: "function",
    name: "createStamp",
    stateMutability: "nonpayable",
    inputs: [
      { name: "contentCommitment", type: "bytes32" },
      { name: "metadataHash", type: "bytes32" },
      { name: "stampNonce", type: "bytes32" }
    ],
    outputs: [{ name: "stampId", type: "bytes32" }]
  },
  {
    type: "function",
    name: "exists",
    stateMutability: "view",
    inputs: [{ name: "stampId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "getStamp",
    stateMutability: "view",
    inputs: [{ name: "stampId", type: "bytes32" }],
    outputs: [
      {
        name: "stamp",
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "createdAt", type: "uint64" },
          { name: "contentCommitment", type: "bytes32" },
          { name: "metadataHash", type: "bytes32" }
        ]
      }
    ]
  },
  {
    type: "event",
    name: "StampCreated",
    anonymous: false,
    inputs: [
      { name: "stampId", type: "bytes32", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "contentCommitment", type: "bytes32", indexed: true },
      { name: "metadataHash", type: "bytes32", indexed: false },
      { name: "createdAt", type: "uint64", indexed: false }
    ]
  }
] as const;

export type RegistryStamp = {
  creator: Address;
  createdAt: bigint;
  contentCommitment: Hex;
  metadataHash: Hex;
};

export function deriveStampId(arguments_: {
  chainId: number;
  registryAddress: Address;
  creator: Address;
  contentCommitment: Hex;
  metadataHash: Hex;
  stampNonce: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" }
      ],
      [
        BigInt(arguments_.chainId),
        arguments_.registryAddress,
        arguments_.creator,
        arguments_.contentCommitment,
        arguments_.metadataHash,
        arguments_.stampNonce
      ]
    )
  );
}
