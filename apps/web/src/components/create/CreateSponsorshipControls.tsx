import type { CreateFundingMode } from "../../create-wallet-state";
import { useI18n } from "../../i18n-context";
import { TurnstileWidget } from "../TurnstileWidget";

type CreateSponsorshipControlsProperties = {
  busy: boolean;
  fundingMode: CreateFundingMode;
  sponsorFailure: string | undefined;
  sponsorGrantReady: boolean;
  sponsorshipCapabilityChecking: boolean;
  sponsorshipCapabilityUnavailable: boolean;
  turnstileSiteKey: string;
  turnstileResetKey: number;
  walletFeeChosen: boolean;
  onChooseWalletFee: () => void;
  onRetrySponsor: () => void;
  onTurnstileError: () => void;
  onTurnstileTokenChange: (token: string | undefined) => void;
};

export function CreateSponsorshipControls({
  busy,
  fundingMode,
  sponsorFailure,
  sponsorGrantReady,
  sponsorshipCapabilityChecking,
  sponsorshipCapabilityUnavailable,
  turnstileSiteKey,
  turnstileResetKey,
  walletFeeChosen,
  onChooseWalletFee,
  onRetrySponsor,
  onTurnstileError,
  onTurnstileTokenChange
}: CreateSponsorshipControlsProperties) {
  const { t } = useI18n();

  return (
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
              {sponsorGrantReady ? (
                <p className="sponsor-ready" role="status">
                  {t("create.sponsorReady")}
                </p>
              ) : (
                <TurnstileWidget
                  accessibleLabel={t("create.sponsorCheckLabel")}
                  onError={onTurnstileError}
                  onTokenChange={onTurnstileTokenChange}
                  resetKey={turnstileResetKey}
                  siteKey={turnstileSiteKey}
                />
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
  );
}
