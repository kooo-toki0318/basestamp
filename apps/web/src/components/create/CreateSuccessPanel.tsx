import { useI18n } from "../../i18n-context";
import { getDeployment } from "../../lib/deployment";
import { getBaseNetwork } from "../../lib/networks";
import type { VerificationPackage } from "../../lib/verification-package";
import { QrCode } from "../QrCode";
import { CreateJourney } from "./CreateJourney";

type CreateSuccessPanelProperties = {
  package_: VerificationPackage;
  handoffUrl: string;
  shareMessage: string;
  webShareAvailable: boolean;
  showShareQr: boolean;
  onDownload: () => void;
  onCopyUrl: () => void;
  onCopyShareMessage: () => void;
  onShare: () => void;
  onToggleQr: () => void;
};

export function CreateSuccessPanel({
  package_,
  handoffUrl,
  shareMessage,
  webShareAvailable,
  showShareQr,
  onDownload,
  onCopyUrl,
  onCopyShareMessage,
  onShare,
  onToggleQr
}: CreateSuccessPanelProperties) {
  const { t } = useI18n();

  return (
    <section className="panel create-success-panel">
      <CreateJourney activeStep={3} />

      <div className="result-box completed-result">
        <div className="result-heading">
          <span className="result-check" aria-hidden="true">✓</span>
          <strong>{t("create.confirmedTitle")}</strong>
        </div>
        <p className="success-lede">{t("create.confirmedBody")}</p>

        <div className="share-panel share-panel-primary">
          <span className="step-label">{t("create.shareTitle")}</span>
          <p className="share-warning">{t("create.shareWarning")}</p>

          <button
            type="button"
            className="share-primary-action"
            onClick={onCopyUrl}
          >
            <span className="share-action-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20">
                <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" />
                <path d="M4.5 13.5h-1A1.5 1.5 0 0 1 2 12V3.5A1.5 1.5 0 0 1 3.5 2H12a1.5 1.5 0 0 1 1.5 1.5v1" />
              </svg>
            </span>
            <span className="share-action-copy">
              <strong>{t("create.copyUrl")}</strong>
              <small>{t("create.copyShareMessageHint")}</small>
            </span>
          </button>

          <div className="success-secondary-actions">
            {webShareAvailable && (
              <button type="button" onClick={onShare}>
                {t("create.webShare")}
              </button>
            )}
            <button type="button" className="secondary" onClick={onDownload}>
              {t("create.downloadPackage")}
            </button>
          </div>
        </div>

        <details className="success-details">
          <summary>{t("create.openDetails")}</summary>

          <div className="result-transaction">
            <span>
              {t("create.transactionHash", {
                network: getBaseNetwork(package_.chainId).name
              })}
            </span>
            <a
              href={
                getDeployment(package_.chainId).explorerUrl +
                "/tx/" +
                package_.transactionHash
              }
              target="_blank"
              rel="noopener noreferrer"
            >
              <code>{package_.transactionHash}</code>
              <span aria-hidden="true">↗</span>
            </a>
          </div>

          <span className="share-label">{t("create.handoffUrl")}</span>
          <div className="share-url-row">
            <a href={handoffUrl} target="_blank" rel="noopener noreferrer">
              {handoffUrl}
            </a>
            <button
              type="button"
              className="icon-button copy-share"
              aria-label={t("create.copyUrl")}
              title={t("create.copyUrl")}
              onClick={onCopyUrl}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" />
                <path d="M4.5 13.5h-1A1.5 1.5 0 0 1 2 12V3.5A1.5 1.5 0 0 1 3.5 2H12a1.5 1.5 0 0 1 1.5 1.5v1" />
              </svg>
            </button>
          </div>

          <span className="share-label">{t("create.shareMessageLabel")}</span>
          <p className="share-message">{shareMessage}</p>
          <button
            type="button"
            className="secondary"
            onClick={onCopyShareMessage}
          >
            {t("create.copyShareMessage")}
          </button>

          <div className="share-secondary-actions standalone-share-actions">
            <button
              type="button"
              onClick={onToggleQr}
              aria-expanded={showShareQr}
              aria-controls="create-handoff-qr"
            >
              {t(showShareQr ? "create.hideQr" : "create.showQr")}
            </button>
          </div>

          {showShareQr && (
            <div className="handoff-qr-panel" id="create-handoff-qr">
              <QrCode value={handoffUrl} label={t("create.qrLabel")} />
              <p>{t("create.qrWarning")}</p>
            </div>
          )}

          <a
            href={package_.verificationUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("nav.verify")}
          </a>
        </details>
      </div>
    </section>
  );
}
