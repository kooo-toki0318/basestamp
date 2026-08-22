
import { describe, expect, it } from "vitest";
import { enMessages } from "../src/locales/en";
import { jaMessages } from "../src/locales/ja";

describe("Mainnet release copy", () => {
  it("does not regress public copy to the retired Sepolia-only release", () => {
    const catalogs = JSON.stringify({ enMessages, jaMessages });
    for (const retiredCopy of [
      "Live Base Sepolia preview",
      "Mainnet writes remain disabled",
      "Base Sepolia transaction",
      "Base Sepolia トランザクション",
      "Registry is not deployed in this release",
      "Mainnet launch remains blocked",
      "Mainnet公開はblock",
      "現在のBase Sepolia preview"
    ]) {
      expect(catalogs).not.toContain(retiredCopy);
    }
  });

  it("keeps route-specific record copy chain-aware", () => {
    for (const key of [
      "create.transactionHash",
      "create.status.recorded",
      "handoffPage.eyebrow",
      "handoffPage.receiptIntro",
      "stamp.eyebrow",
      "stamp.lede"
    ] as const) {
      expect(enMessages[key]).toContain("{network}");
      expect(jaMessages[key]).toContain("{network}");
    }
  });
});
