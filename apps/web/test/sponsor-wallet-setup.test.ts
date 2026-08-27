import { describe, expect, it } from "vitest";
import {
  classifySponsorWalletBytecode,
  isLikelyWalletSetupFundingError
} from "../src/sponsor-wallet-setup";

describe("sponsored wallet setup detection", () => {
  it("flags an account with no deployed or delegated code", () => {
    expect(classifySponsorWalletBytecode(undefined)).toBe(
      "setup-may-be-required"
    );
    expect(classifySponsorWalletBytecode("0x")).toBe(
      "setup-may-be-required"
    );
  });

  it("accepts EIP-7702 delegation and other account code as already set up", () => {
    expect(
      classifySponsorWalletBytecode(
        "0xef01001234567890123456789012345678901234567890"
      )
    ).toBe("ready");
    expect(classifySponsorWalletBytecode("0x6001600055")).toBe("ready");
  });

  it("recognizes wallet funding errors that can indicate first-time setup", () => {
    expect(
      isLikelyWalletSetupFundingError(
        new Error(
          "Error generating transaction. Please make sure you have enough funds to complete the transaction"
        )
      )
    ).toBe(true);
    expect(
      isLikelyWalletSetupFundingError(new Error("insufficient funds for gas"))
    ).toBe(true);
    expect(
      isLikelyWalletSetupFundingError(new Error("user rejected request"))
    ).toBe(false);
  });
});
