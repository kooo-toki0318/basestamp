import type { Address } from "viem";
import type { CreateWalletState } from "../../create-wallet-state";
import { useI18n } from "../../i18n-context";
import type { SupportedChainId } from "../../lib/networks";

type CreateAccessPanelProperties = {
  address: Address | undefined;
  walletState: CreateWalletState;
  walletChainId: number | undefined;
  selectedChainId: SupportedChainId;
  selectedNetworkName: string;
  authBusy: boolean;
  busy: boolean;
  baseSignInAvailable: boolean;
  browserSignInAvailable: boolean;
  onSignInBase: () => void;
  onSignInBrowser: () => void;
  onSwitchNetwork: () => void;
};

export function CreateAccessPanel({
  address,
  walletState,
  walletChainId,
  selectedChainId,
  selectedNetworkName,
  authBusy,
  busy,
  baseSignInAvailable,
  browserSignInAvailable,
  onSignInBase,
  onSignInBrowser,
  onSwitchNetwork
}: CreateAccessPanelProperties) {
  const { t } = useI18n();

  if (address === undefined) {
    return (
      <section
        className="auth-readiness"
        aria-labelledby="create-auth-heading"
      >
        <div className="auth-readiness-copy">
          <h2 id="create-auth-heading">{t("create.authTitle")}</h2>
          <p>{t("create.authIntro")}</p>
        </div>
        <ol className="auth-checklist">
          <li className="is-needed">
            <span className="auth-check-number">1</span>
            <span>
              <strong>{t("create.walletStep")}</strong>
              <small>{t("create.walletMissing")}</small>
            </span>
            <span className="requirement-badge">
              {t("create.requirementNeeded")}
            </span>
          </li>
        </ol>
        <div className="auth-readiness-actions">
          <button
            type="button"
            onClick={onSignInBase}
            disabled={authBusy || !baseSignInAvailable}
          >
            {t("auth.signInBase")}
          </button>
          {browserSignInAvailable && (
            <button
              className="secondary"
              type="button"
              onClick={onSignInBrowser}
              disabled={authBusy}
            >
              {t("auth.browserWallet")}
            </button>
          )}
        </div>
      </section>
    );
  }

  if (walletState === "wrong-network") {
    return (
      <section
        className="authentication-prompt network-prompt"
        aria-labelledby="create-network-heading"
      >
        <span className="authentication-prompt-icon" aria-hidden="true">
          ↔
        </span>
        <div>
          <p className="authentication-prompt-kicker">
            {t("create.networkStep")}
          </p>
          <h2 id="create-network-heading">
            {t("create.networkTitle", { network: selectedNetworkName })}
          </h2>
          <p>
            {t("create.networkIntro", {
              current: walletChainId ?? t("network.notConnected"),
              network: selectedNetworkName,
              target: selectedChainId
            })}
          </p>
        </div>
        <div className="authentication-prompt-action">
          <button
            type="button"
            onClick={onSwitchNetwork}
            disabled={busy || authBusy}
          >
            {t("auth.switchTo", { network: selectedNetworkName })}
          </button>
        </div>
      </section>
    );
  }

  return null;
}
