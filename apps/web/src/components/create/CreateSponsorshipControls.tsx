import { useQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";
import type { CreateFundingMode } from "../../create-wallet-state";
import { useI18n } from "../../i18n-context";
import { isSupportedChainId } from "../../lib/networks";
import { getDeploymentPublicClient } from "../../lib/onchain";
import { classifySponsorWalletBytecode } from "../../sponsor-wallet-setup";
import { TurnstileWidget } from "../TurnstileWidget";

type BaseInjectedProvider = {
  isBase?: boolean;
  isCoinbaseWallet?: boolean;
};

function isBaseProvider(provider: unknown): boolean {
  if (typeof provider !== "object" || provider === null) return false;
  const candidate = provider as BaseInjectedProvider;
  return candidate.isBase === true || candidate.isCoinbaseWallet === true;
}

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
  const { address, chainId, connector } = useConnection();
  const supportedChainId =
    chainId !== undefined && isSupportedChainId(chainId) ? chainId : undefined;
  const shouldCheckWalletSetup =
    fundingMode === "sponsored" &&
    !walletFeeChosen &&
    !sponsorshipCapabilityChecking &&
    !sponsorshipCapabilityUnavailable &&
    address !== undefined &&
    supportedChainId !== undefined &&
    connector !== undefined;
  const walletSetupQuery = useQuery({
    queryKey: ["sponsor-wallet-code", connector?.uid, supportedChainId, address],
    queryFn: async () => {
      if (
        address === undefined ||
        supportedChainId === undefined ||
        connector === undefined
      ) {
        return "code-present" as const;
      }
      const provider = await connector.getProvider();
      if (connector.id !== "baseAccount" && !isBaseProvider(provider)) {
        return "code-present" as const;
      }
      const bytecode = await getDeploymentPublicClient(
        supportedChainId
      ).getCode({ address });
      return classifySponsorWalletBytecode(bytecode);
    },
    enabled: shouldCheckWalletSetup,
    staleTime: 30_000
  });
  const walletSetupChecking =
    shouldCheckWalletSetup && walletSetupQuery.fetchStatus === "fetching";
  const walletHasNoCode =
    shouldCheckWalletSetup && walletSetupQuery.data === "no-code";

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
            ? walletSetupChecking
              ? t("create.walletSetupChecking")
              : walletHasNoCode
                ? t("create.walletSetupMayBeRequired")
                : t("create.sponsorReady")
            : t("create.walletFeeSelected")}
        </strong>
      </div>

      {fundingMode === "sponsored" ? (
        <>
          {walletSetupChecking && (
            <div className="sponsor-capability-progress" role="status">
              <span className="confirmation-spinner compact" aria-hidden="true" />
              <span>{t("create.walletSetupChecking")}</span>
            </div>
          )}
          {walletHasNoCode && (
            <div className="notice" role="status">
              <strong>{t("create.walletSetupTitle")}</strong>
              <p>{t("create.walletSetupBody")}</p>
            </div>
          )}
          {!walletSetupChecking && !sponsorGrantReady && (
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
