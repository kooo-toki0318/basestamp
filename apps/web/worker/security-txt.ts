import { EXPECTED_SECURITY_ADVISORY_URL } from "../src/public-pages";

export const EXPECTED_SECURITY_CONTACT_URL = EXPECTED_SECURITY_ADVISORY_URL;
export const SECURITY_POLICY_URL =
  "https://basestamp-web.ndun000.workers.dev/security";
export const SECURITY_TXT_CANONICAL_URL =
  "https://basestamp-web.ndun000.workers.dev/.well-known/security.txt";
export const SECURITY_TXT_EXPIRES = "2027-02-13T00:00:00Z";

export function createSecurityTxt(
  configuredContact: string | undefined
): string | undefined {
  if (configuredContact?.trim() !== EXPECTED_SECURITY_CONTACT_URL) {
    return undefined;
  }
  return [
    `Contact: ${EXPECTED_SECURITY_CONTACT_URL}`,
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    `Canonical: ${SECURITY_TXT_CANONICAL_URL}`,
    "Preferred-Languages: ja, en",
    `Policy: ${SECURITY_POLICY_URL}`,
    ""
  ].join("\n");
}
