import { describe, expect, it } from "vitest";
import { detectPreferredLocale, isLocale, localeTag } from "../src/locale";

describe("locale selection", () => {
  it("prefers the first supported browser language", () => {
    expect(detectPreferredLocale(["fr-FR", "ja-JP", "en-US"])).toBe("ja");
    expect(detectPreferredLocale(["en-GB", "ja-JP"])).toBe("en");
  });

  it("falls back to English for unsupported or empty language lists", () => {
    expect(detectPreferredLocale(["fr-FR"])).toBe("en");
    expect(detectPreferredLocale([])).toBe("en");
  });

  it("accepts only configured locale identifiers", () => {
    expect(isLocale("ja")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ja-JP")).toBe(false);
  });

  it("returns stable Intl locale tags", () => {
    expect(localeTag("ja")).toBe("ja-JP");
    expect(localeTag("en")).toBe("en-US");
  });
});
