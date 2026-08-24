import type { MessageKey } from "./en";
import type { Locale } from "../locale";

export const releaseCopy = {
  en: {
    "create.title": "Create a Base record for a file.",
    "create.lede": "Choose a file and its purpose. BaseStamp creates a record you can use to verify the same file later; the original file is not uploaded to BaseStamp or Base."
  },
  ja: {
    "create.title": "ファイルの記録をBaseに残す。",
    "create.lede": "ファイルと用途を選ぶと、あとで同じファイルか確認できる記録を作成します。元ファイル自体はBaseStampにもBaseにもアップロードされません。"
  }
} satisfies Record<Locale, Partial<Record<MessageKey, string>>>;
