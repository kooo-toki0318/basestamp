import {
  detectPreferredLocale,
  type Locale
} from "./locale";

type LanguagePreference = {
  language: string;
  quality: number;
  order: number;
};

export function detectLocaleFromAcceptLanguage(
  header: string | null
): Locale {
  if (header === null) return "en";

  const preferences: LanguagePreference[] = [];
  for (const [order, entry] of header.split(",").entries()) {
    const [rawLanguage = "", ...parameters] = entry.trim().split(";");
    const language = rawLanguage.trim();
    if (language === "" || language === "*") continue;

    let quality = 1;
    for (const parameter of parameters) {
      const match = /^q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/iu.exec(
        parameter.trim()
      );
      if (match !== null) quality = Number(match[1]);
    }
    if (quality > 0) preferences.push({ language, quality, order });
  }

  preferences.sort(
    (left, right) => right.quality - left.quality || left.order - right.order
  );
  return detectPreferredLocale(
    preferences.map((preference) => preference.language)
  );
}
