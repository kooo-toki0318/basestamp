import { getAddress, isAddress, isHex, numberToHex, type Address, type Hex } from "viem";

export const SIWE_STATEMENT =
  "Sign in to BaseStamp. This does not authorize a transaction.";

export type NonceResponse = {
  nonce: string;
  domain: string;
  uri: string;
  chainId: number;
  issuedAt: string;
  expirationTime: string;
};

export type SignedSiweMessage = {
  message: string;
  signature: Hex;
};

export function createBaseSiweCapability(nonce: NonceResponse) {
  return {
    nonce: nonce.nonce,
    chainId: numberToHex(nonce.chainId),
    domain: nonce.domain,
    uri: nonce.uri,
    version: "1",
    issuedAt: nonce.issuedAt,
    expirationTime: nonce.expirationTime,
    statement: SIWE_STATEMENT
  } as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function readConnectedAddress(value: unknown): Address | undefined {
  if (!isRecord(value) || !isUnknownArray(value.accounts)) return undefined;
  const account = value.accounts[0];
  const candidate =
    typeof account === "string"
      ? account
      : isRecord(account) && typeof account.address === "string"
        ? account.address
        : undefined;
  return candidate !== undefined && isAddress(candidate)
    ? getAddress(candidate)
    : undefined;
}

export function readBaseSiweResponse(value: unknown):
  | { address: Address; signedMessage: SignedSiweMessage }
  | undefined {
  if (!isRecord(value) || !isUnknownArray(value.accounts)) return undefined;
  const account = value.accounts[0];
  if (!isRecord(account) || typeof account.address !== "string") {
    return undefined;
  }
  if (!isAddress(account.address)) return undefined;
  const capabilities = account.capabilities;
  if (!isRecord(capabilities)) return undefined;
  const signIn = capabilities.signInWithEthereum;
  if (
    !isRecord(signIn) ||
    typeof signIn.message !== "string" ||
    typeof signIn.signature !== "string" ||
    !isHex(signIn.signature)
  ) {
    return undefined;
  }
  return {
    address: getAddress(account.address),
    signedMessage: {
      message: signIn.message,
      signature: signIn.signature
    }
  };
}
