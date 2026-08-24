import type { Hex } from "viem";
import type {
  CreateConfirmationState,
  CreateFundingMode,
  CreateWalletState
} from "../../create-wallet-state";
import { useI18n } from "../../i18n-context";
import { getDeployment } from "../../lib/deployment";
import type { SupportedChainId } from "../../lib/networks";
import { TurnstileWidget } from "../TurnstileWidget";

type PendingSubmission = {
  chainId: SupportedChainId;
  submittedHash?: Hex;
};

type CreateSubmitPanelProperties = {
  busy: boolean;
  confirmationState: CreateConfirmationState;
  fundingMode: CreateFundingMode;
  pendingConfirmation: PendingSubmission | undefined;
  preparedAvailable: boolean;
  readyToRecord: boolean;
  registryAvailable: boolean;
  selectedNetworkName: string;
  sponsorshipAvailable: boolean;
  sponsorshipCapabilityChecking: boolean;
  sponsorshipCapabilityUnavailable: boolean;
  sponsorshipConfigured: boolean;
  sponsorFailure: string | undefined;
  sponsorGrantReady: boolean;
  turnstileSiteKey: string | undefined;
  turnstileResetKey: number;
  turnstileTokenReady: boolean;
  walletFeeChosen: boolean;
  walletState: CreateWalletState;
  onChooseWalletFee: () => void;
  onRetrySponsor: () => void;
  onSubmit: () => void;
  onTurnstileError: () => void;
  onTurnstileTokenChange: (token: string | undefined) => void;
};

export function CreateSubmitPanel({
  busy,
  confirmationState,
  fundingMode,
  pendingConfirmation,
  preparedAvailable,
  readyToRecord,
  registryAvailable,
  selectedNetworkName,
  sponsorshipAvailable,
  sponsorshipCapabilityChecking,
  sponsorshipCapabilityUnavailable,
  sponsorshipConfigured,
  sponsorFailure,
  sponsorGrantReady,
  turnstileSiteKey,
  turnstileResetKey,
  turnstileTokenReady,
  walletFeeChosen,
  walletState,
  onChooseWalletFee,
  onRetrySponsor,
  onSubmit,
  onTurnstileError,
  onTurnstileTokenChange
}: CreateSubmitPanelProperties) {
  const { t } = useI18n();

  return (
    <section
      className="panel"
      aria-busy={confirmationState === "confirming"}
    >
      <span className="step-label">{t("create.step3")}</span>
      {!registryAvailable && (
        <p className="muted">
          {t("create.mainnetUnavailable", { network: selectedNetworkName })}
        </p>
      )}
      {registryAvailable &&
        pendingConfirmation === undefined &&
        !readyToRecord && (
          <p className="muted">
            {t(
              walletState === "wrong-network"
                ? "create.networkHint"
                : "create.signInHint",
              { network: selectedNetworkName }
            )}
          </p>
        )}
      {pendingConfirmation !== undefined && (
        <>
          {confirmationState === "confirming" && (
            <div className="confirmation-progress" role="status">
              <span className="confirmation-spinner" aria-hidden="true" />
              <div>
                <strong>{t("create.confirmingTitle")}</strong>
                <p>{t("create.confirmingBody")}</p>
              </div>
            </div>
          )}
          {pendingConfirmation.submittedHash !== undefined && (
            <a
              href={
                getDeployment(pendingConfirmation.chainId).explorerUrl +
                "/tx/" +
                pendingConfirmation.submittedHash
              }
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("create.viewTransaction")}
            </a>
          )}
        </>
      )}
      {sponsorshipConfigured &&
        pendingConfirmation === undefined &&
        preparedAvailable &&
        readyToRecord && (
          <div className="sponsor-choice">
            {sponsorshipCapabilityChecking ? (
              <>
                <div>
                  <strong>{t("create.sponsorCapabilityCheckingTitle")}</strong>
                  <p>{t("create.sponsorCapabilityCheckingBody")}</p>
                </div>
                <div className="sponsor-capability-progress" role="status">
                  <span
                    className="confirmation-spinner compact"
                    aria-hidden="true"
                  />
                  <span>{t("create.sponsorCapabilityCheckingStatus")}</span>
                </div>
                {walletFeeChosen ? (
                  <p className="sponsor-wallet-paid">
                    {t("create.walletFeeSelected")}
                  </p>
                ) : (
                  <button
                    type="button"
                    className="secondary sponsor-choice-action"
                    onClick={onChooseWalletFee}
                    disabled={busy}
                  >
                    {t("create.useWalletFee")}
                  </button>
                )}
              </>
            ) : sponsorshipCapabilityUnavailable ? (
              <>
                <div>
                  <strong>{t("create.sponsorCapabilityUnavailableTitle")}</strong>
                  <p>{t("create.sponsorCapabilityUnavailableBody")}</p>
                </div>
                {walletFeeChosen ? (
                  <p className="sponsor-wallet-paid">
                    {t("create.walletFeeSelected")}
                  </p>
                ) : (
                  <button
                    type="button"
                    className="secondary sponsor-choice-action"
                    onClick={onChooseWalletFee}
                    disabled={busy}
                  >
                    {t("create.useWalletFee")}
                  </button>
                )}
              </>
            ) : (
              <>
                <div>
                  <strong>{t("create.sponsorTitle")}</strong>
                  <p>{t("create.sponsorIntro")}</p>
                </div>
                {fundingMode === "sponsored" ? (
                  <>
                    {!sponsorGrantReady && turnstileSiteKey !== undefined ? (
                      <TurnstileWidget
                        accessibleLabel={t("create.sponsorCheckLabel")}
                        onError={onTurnstileError}
                        onTokenChange={onTurnstileTokenChange}
                        resetKey={turnstileResetKey}
                        siteKey={turnstileSiteKey}
                      />
                    ) : (
                      <p className="sponsor-ready" role="status">
                        {t("create.sponsorReady")}
                      </p>
                    )}
                    {sponsorFailure !== undefined && (
                      <p className="sponsor-error" role="alert">
                        {sponsorFailure}
                      </p>
                    )}
                    <button
                      type="button"
                      className="secondary sponsor-choice-action"
                      onClick={onChooseWalletFee}
                      disabled={busy}
                    >
                      {t("create.useWalletFee")}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="sponsor-wallet-paid">
                      {t("create.walletFeeSelected")}
                    </p>
                    <button
                      type="button"
                      className="secondary sponsor-choice-action"
                      onClick={onRetrySponsor}
                      disabled={busy}
                    >
                      {t("create.trySponsor")}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      <button
        type="button"
        className={
          confirmationState === "confirming"
            ? "confirmation-button is-confirming"
            : undefined
        }
        onClick={onSubmit}
        disabled={
          busy ||
          (pendingConfirmation === undefined &&
            (!preparedAvailable ||
              !readyToRecord ||
              !registryAvailable ||
              (sponsorshipConfigured &&
                !sponsorshipAvailable &&
                !walletFeeChosen) ||
              (fundingMode === "sponsored" &&
                !sponsorGrantReady &&
                !turnstileTokenReady)))
        }
      >
        {confirmationState === "idle"
          ? sponsorshipCapabilityChecking && !walletFeeChosen
            ? t("create.checkingSponsor")
            : t(
                fundingMode === "sponsored"
                  ? "create.recordSponsored"
                  : "create.recordOn",
                { network: selectedNetworkName }
              )
          : confirmationState === "confirming"
            ? (
                <span className="confirmation-button-content">
                  <span
                    className="confirmation-spinner compact"
                    aria-hidden="true"
                  />
                  {t("create.confirming")}
                </span>
              )
            : t("create.retryConfirmation")}
      </button>
      <p className="muted">
        {registryAvailable
          ? sponsorshipCapabilityChecking && !walletFeeChosen
            ? t("create.sponsorCapabilityCheckingBody")
            : t(
                fundingMode === "sponsored"
                  ? "create.sponsorFeeNotice"
                  : "create.feeNotice",
                { network: selectedNetworkName }
              )
          : t("create.noMainnetTransaction", {
              network: selectedNetworkName
            })}
      </p>
    </section>
  );
}
