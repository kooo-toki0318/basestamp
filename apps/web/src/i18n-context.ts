import { createContext, useContext } from "react";
import type { Locale } from "./locale";
import type { BaseAccountSetupMessageKey } from "./locales/base-account-setup-copy";
import type { MessageKey as BaseMessageKey } from "./locales/en";

export type MessageKey = BaseMessageKey | BaseAccountSetupMessageKey;

export type TranslationValues = Readonly<Record<string, string | number>>;
export type Translate = (
  key: MessageKey,
  values?: TranslationValues
) => string;

export type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
};

export const I18nContext = createContext<I18nContextValue | undefined>(
  undefined
);

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error("useI18n must be used within I18nProvider.");
  }
  return context;
}
