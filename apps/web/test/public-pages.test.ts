import { describe, expect, it } from "vitest";
import {
  EXPECTED_SECURITY_ADVISORY_URL,
  getPublicInformationPage,
  hasVerifiedSecurityContact
} from "../src/public-pages";

describe("public information routes", () => {
  it.each([
    ["/about/legal", "legal"],
    ["/about/legal/", "legal"],
    ["/privacy", "privacy"],
    ["/privacy/", "privacy"],
    ["/terms", "terms"],
    ["/terms/", "terms"],
    ["/security", "security"],
    ["/security/", "security"]
  ] as const)("resolves %s", (pathname, page) => {
    expect(getPublicInformationPage(pathname)).toBe(page);
  });

  it("does not treat prefixes or nested paths as public pages", () => {
    expect(getPublicInformationPage("/privacy-policy")).toBeUndefined();
    expect(getPublicInformationPage("/security/report")).toBeUndefined();
  });

  it("enables security reporting only for the exact reviewed contact", () => {
    expect(hasVerifiedSecurityContact(undefined)).toBe(false);
    expect(hasVerifiedSecurityContact("")).toBe(false);
    expect(hasVerifiedSecurityContact("https://example.com/report")).toBe(false);
    expect(
      hasVerifiedSecurityContact(` ${EXPECTED_SECURITY_ADVISORY_URL} `)
    ).toBe(true);
  });
});
