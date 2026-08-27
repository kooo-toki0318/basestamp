import { describe, expect, it } from "vitest";
import { classifySponsorWalletBytecode } from "../src/sponsor-wallet-setup";

describe("sponsored wallet bytecode preflight", () => {
  it("reports no code before deployment or EIP-7702 delegation", () => {
    expect(classifySponsorWalletBytecode(undefined)).toBe("no-code");
    expect(classifySponsorWalletBytecode("0x")).toBe("no-code");
  });

  it("reports EIP-7702 delegation and other account code as present", () => {
    expect(
      classifySponsorWalletBytecode(
        "0xef01001234567890123456789012345678901234567890"
      )
    ).toBe("code-present");
    expect(classifySponsorWalletBytecode("0x6001600055")).toBe(
      "code-present"
    );
  });
});
