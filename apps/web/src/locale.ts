export const SUPPORTED_LOCALES = ["ja", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export function isLocale(value: string): value is Locale {
  return SUPPORTED_LOCALES.some((locale) => locale === value);
}

export function detectPreferredLocale(
  languages: readonly string[]
): Locale {
  for (const language of languages) {
    const normalized = language.trim().toLowerCase().split("-", 1)[0] ?? "";
    if (isLocale(normalized)) return normalized;
  }
  return "en";
}

export function localeTag(locale: Locale): "en-US" | "ja-JP" {
  return locale === "ja" ? "ja-JP" : "en-US";
}
