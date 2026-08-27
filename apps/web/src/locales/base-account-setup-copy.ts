import type { Locale } from "../locale";

const en = {
  "create.walletSetupChecking": "Checking Base wallet setup…",
  "create.walletSetupMayBeRequired": "One-time Base wallet setup may be required",
  "create.walletSetupTitle": "This Base wallet may need a one-time setup first",
  "create.walletSetupBody": "This account does not yet have wallet code on the selected Base network. Base may require a one-time network fee to upgrade the wallet before app-provided gas sponsorship can be used. The BaseStamp transaction itself will remain sponsored once the wallet is set up.",
  "create.status.walletSetupFailed": "This Base wallet appears to need its one-time Base setup before sponsored gas can be used. Base may require a network fee for that setup. No wallet-paid BaseStamp transaction was sent."
} as const;

export type BaseAccountSetupMessageKey = keyof typeof en;

const ja: Record<BaseAccountSetupMessageKey, string> = {
  "create.walletSetupChecking": "Baseウォレットの初回セットアップ状態を確認しています…",
  "create.walletSetupMayBeRequired": "Baseウォレットの初回セットアップが必要な可能性があります",
  "create.walletSetupTitle": "このBaseウォレットは先に1回だけセットアップが必要な可能性があります",
  "create.walletSetupBody": "このアカウントには、選択中のBaseネットワーク上でまだウォレットコードがありません。BaseStampのガススポンサーを使う前に、Base側のウォレットアップグレードで1回だけネットワーク手数料を求められる場合があります。セットアップ後のBaseStampトランザクション自体はスポンサー対象です。",
  "create.status.walletSetupFailed": "このBaseウォレットは、スポンサー付きトランザクションを使う前に1回だけBase側のセットアップが必要な状態とみられます。そのセットアップではネットワーク手数料を求められる場合があります。BaseStampからウォレット負担のトランザクションは送信していません。"
};

export const baseAccountSetupCopy: Record<
  Locale,
  Record<BaseAccountSetupMessageKey, string>
> = { en, ja };
