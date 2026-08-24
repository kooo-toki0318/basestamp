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

  if (sponsorshipCapabilityChecking) {
    return (
      <div className="gas-control compact-gas-control">
        <div className="gas-summary-row">
          <span>{t("create.sponsorTitle")}</span>
          <strong>{t("create.sponsorCapabilityCheckingStatus")}</strong>
        </div>
        <div className="sponsor-capability-progress" role="status">
          <span className="confirmation-spinner compact" aria-hidden="true" />
          <span>{t("create.sponsorCapabilityCheckingBody")}</span>
        </div>
        {!walletFeeChosen && (
          <button
            type="button"
            className="secondary sponsor-choice-action"
            onClick={onChooseWalletFee}
            disabled={busy}
          >
            {t("create.useWalletFee")}
          </button>
        )}
      </div>
    );
  }

  if (sponsorshipCapabilityUnavailable) {
    return (
      <div className="gas-control compact-gas-control">
        <div className="gas-summary-row">
          <span>{t("create.sponsorTitle")}</span>
          <strong>{t("create.sponsorCapabilityUnavailableTitle")}</strong>
        </div>
        <p>{t("create.sponsorCapabilityUnavailableBody")}</p>
        {!walletFeeChosen && (
          <button
            type="button"
            className="secondary sponsor-choice-action"
            onClick={onChooseWalletFee}
            disabled={busy}
          >
            {t("create.useWalletFee")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="gas-control compact-gas-control">
      <div className="gas-summary-row">
        <span>{t("create.sponsorTitle")}</span>
        <strong>
          {fundingMode === "sponsored"
            ? t("create.sponsorReady")
            : t("create.walletFeeSelected")}
        </strong>
      </div>

      {fundingMode === "sponsored" ? (
        <>
          {!sponsorGrantReady && (
            <TurnstileWidget
              accessibleLabel={t("create.sponsorCheckLabel")}
              onError={onTurnstileError}
              onTokenChange={onTurnstileTokenChange}
              resetKey={turnstileResetKey}
              siteKey={turnstileSiteKey}
            />
          )}
          {sponsorFailure !== undefined && (
            <p className="sponsor-error" role="alert">{sponsorFailure}</p>
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
        <button
          type="button"
          className="secondary sponsor-choice-action"
          onClick={onRetrySponsor}
          disabled={busy}
        >
          {t("create.trySponsor")}
        </button>
      )}
    </div>
  );
}
