import type { Hex } from "viem";

export type SponsorWalletSetupState =
  | "ready"
  | "setup-may-be-required"
  | "unknown";

export function classifySponsorWalletBytecode(
  bytecode: Hex | undefined
): SponsorWalletSetupState {
  if (bytecode === undefined || bytecode === "0x") {
    return "setup-may-be-required";
  }
  return "ready";
}

export function isLikelyWalletSetupFundingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("enough funds") ||
    message.includes("insufficient funds") ||
    message.includes("insufficient balance")
  );
}
