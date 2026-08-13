export type PublicInformationPage =
  | "legal"
  | "privacy"
  | "terms"
  | "security";

export const EXPECTED_SECURITY_ADVISORY_URL =
  "https://github.com/kooo-toki0318/basestamp/security/advisories/new";

export function hasVerifiedSecurityContact(
  value: string | undefined
): boolean {
  return value?.trim() === EXPECTED_SECURITY_ADVISORY_URL;
}

const PUBLIC_INFORMATION_ROUTES = new Map<string, PublicInformationPage>([
  ["/about/legal", "legal"],
  ["/privacy", "privacy"],
  ["/terms", "terms"],
  ["/security", "security"]
]);

export function getPublicInformationPage(
  pathname: string
): PublicInformationPage | undefined {
  const normalizedPath =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  return PUBLIC_INFORMATION_ROUTES.get(normalizedPath);
}
