import { getAddress } from "viem";

export const BASE_ACCOUNT_FACTORY = getAddress(
  "0xba5ed110efdba3d005bfc882d75358acbbb85842"
);
export const BASE_ACCOUNT_IMPLEMENTATION = getAddress(
  "0x00000110dCdEdC9581cb5eCB8467282f2926534d"
);
export const BASE_ACCOUNT_ERC6492_VALIDATOR = getAddress(
  "0xcfCE48B757601F3f351CB6f434CB0517aEEE293D"
);
export const BASE_ACCOUNT_ENTRY_POINT = getAddress(
  "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"
);

export const BASE_ACCOUNT_FACTORY_CODE_HASH =
  "0xb60a629aa7c6af9b550871fd21b67ab84638156683cec68491049cb5d235ed2f";
export const BASE_ACCOUNT_IMPLEMENTATION_CODE_HASH =
  "0x136185896fc519277ec953c0b3d048fc0c9f607b8d04022e60f23ef8dbc6c4d5";
export const BASE_ACCOUNT_VALIDATOR_CODE_HASH =
  "0x94a000eab18fdda0465241bd0e82487463fb2e539854a3645542e57ed8dde484";

export const baseAccountAbi = [
  {
    type: "function",
    name: "entryPoint",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "implementation",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }]
  },
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "executeBatch",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" }
        ]
      }
    ],
    outputs: []
  },
  {
    type: "function",
    name: "executeWithoutChainIdValidation",
    stateMutability: "payable",
    inputs: [{ name: "calls", type: "bytes[]" }],
    outputs: []
  }
] as const;

export const baseAccountFactoryAbi = [
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
