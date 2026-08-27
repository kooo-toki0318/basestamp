import type { Hex } from "viem";

export type SponsorWalletCodeState = "code-present" | "no-code";

export function classifySponsorWalletBytecode(
  bytecode: Hex | undefined
): SponsorWalletCodeState {
  return bytecode === undefined || bytecode === "0x"
    ? "no-code"
    : "code-present";
}
