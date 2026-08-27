import type { Locale } from "../locale";

const en = {
  "create.walletSetupChecking": "Checking Base wallet setup…",
  "create.walletSetupMayBeRequired": "New Base wallet detected",
  "create.walletSetupTitle": "BaseStamp will try sponsored first-use setup",
  "create.walletSetupBody": "This account does not yet have wallet code on the selected Base network. BaseStamp will still request app-sponsored gas; new Base accounts can be provisioned through that sponsored flow. If the wallet unexpectedly asks you to pay a network fee, do not approve a wallet-paid transaction and report the error.",
  "create.status.walletSetupFailed": "The Base wallet could not complete the sponsored first-use flow. No wallet-paid BaseStamp transaction was sent."
} as const;

export type BaseAccountSetupMessageKey = keyof typeof en;

const ja: Record<BaseAccountSetupMessageKey, string> = {
  "create.walletSetupChecking": "Baseウォレットの初回状態を確認しています…",
  "create.walletSetupMayBeRequired": "新しいBaseウォレットを検出しました",
  "create.walletSetupTitle": "スポンサー付きの初回セットアップを試します",
  "create.walletSetupBody": "このアカウントには、選択中のBaseネットワーク上でまだウォレットコードがありません。BaseStampはそのままアプリ負担のガススポンサーを要求します。新しいBaseアカウントは、このスポンサー経路で初回セットアップまで完了できる想定です。もしウォレットからネットワーク手数料の自己負担を求められた場合は、ウォレット負担のトランザクションを承認せず、表示されたエラーを報告してください。",
  "create.status.walletSetupFailed": "Baseウォレットのスポンサー付き初回フローを完了できませんでした。BaseStampからウォレット負担のトランザクションは送信していません。"
};

export const baseAccountSetupCopy: Record<
  Locale,
  Record<BaseAccountSetupMessageKey, string>
> = { en, ja };
