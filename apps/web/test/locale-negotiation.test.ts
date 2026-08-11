import { describe, expect, it } from "vitest";
import { detectLocaleFromAcceptLanguage } from "../src/locale-negotiation";

describe("Accept-Language locale negotiation", () => {
  it("uses quality weights before header order", () => {
    expect(
      detectLocaleFromAcceptLanguage("en-US;q=0.7, ja-JP;q=0.9")
    ).toBe("ja");
  });

  it("uses header order when weights are equal", () => {
    expect(detectLocaleFromAcceptLanguage("ja, en;q=1")).toBe("ja");
  });

  it("ignores wildcard, disabled, and unsupported languages", () => {
    expect(
      detectLocaleFromAcceptLanguage("fr-FR, *;q=0.8, ja;q=0")
    ).toBe("en");
  });
});
