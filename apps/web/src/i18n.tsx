import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  I18nContext,
  type MessageKey,
  type Translate,
  type TranslationValues
} from "./i18n-context";
import {
  detectPreferredLocale,
  isLocale,
  type Locale
} from "./locale";
import { baseAccountSetupCopy } from "./locales/base-account-setup-copy";
import { enMessages } from "./locales/en";
import { jaMessages } from "./locales/ja";
import { productCopy } from "./locales/product-copy";
import { releaseCopy } from "./locales/release-copy";

const catalogs: Record<Locale, Record<MessageKey, string>> = {
  en: {
    ...enMessages,
    ...productCopy.en,
    ...releaseCopy.en,
    ...baseAccountSetupCopy.en
  },
  ja: {
    ...jaMessages,
    ...productCopy.ja,
    ...releaseCopy.ja,
    ...baseAccountSetupCopy.ja
  }
};
const STORAGE_KEY = "basestamp.locale";

function readStoredLocale(): Locale | undefined {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored !== null && isLocale(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

function readLocaleResponse(value: unknown): Locale | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const locale = (value as Record<string, unknown>).locale;
  return typeof locale === "string" && isLocale(locale) ? locale : undefined;
}

function initialLocale(): Locale {
  return readStoredLocale() ?? detectPreferredLocale(navigator.languages);
}

function interpolate(template: string, values?: TranslationValues): string {
  if (values === undefined) return template;
  return template.replaceAll(/\{([^{}]+)\}/gu, (placeholder, key: string) => {
    const value = values[key];
    return value === undefined ? placeholder : String(value);
  });
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    if (readStoredLocale() !== undefined) return;
    const controller = new AbortController();
    void fetch("/api/locale", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return undefined;
        const value: unknown = await response.json();
        return readLocaleResponse(value);
      })
      .then((serverLocale) => {
        if (
          serverLocale !== undefined &&
          !controller.signal.aborted &&
          readStoredLocale() === undefined
        ) {
          setLocaleState(serverLocale);
        }
      })
      .catch(() => {
        // The navigator-language fallback remains active if negotiation fails.
      });
    return () => {
      controller.abort();
    };
  }, []);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    try {
      window.localStorage.setItem(STORAGE_KEY, nextLocale);
    } catch {
      // The selection still applies for the current page.
    }
  }, []);

  const t = useCallback<Translate>(
    (key, values) => interpolate(catalogs[locale][key], values),
    [locale]
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    const description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]'
    );
    if (description !== null) description.content = t("app.description");
  }, [locale, t]);

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
