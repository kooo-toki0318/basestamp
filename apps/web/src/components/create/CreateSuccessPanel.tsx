import { useI18n } from "../../i18n-context";
import { clearLatestCreatedVerificationPackage } from "../../local-package";
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

  function startNewRecord(): void {
    clearLatestCreatedVerificationPackage();
    window.location.replace("/create");
  }

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

          <div className="success-action-row">
            {webShareAvailable && (
              <button
                type="button"
                className="secondary success-share-action"
                onClick={onShare}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M10 13.5V3" />
                  <path d="m6.5 6.5 3.5-3.5 3.5 3.5" />
                  <path d="M5 9.5H3.5A1.5 1.5 0 0 0 2 11v4.5A1.5 1.5 0 0 0 3.5 17h13a1.5 1.5 0 0 0 1.5-1.5V11a1.5 1.5 0 0 0-1.5-1.5H15" />
                </svg>
                <span>{t("create.webShare")}</span>
              </button>
            )}
            <button
              type="button"
              className="success-download-action"
              onClick={onDownload}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M10 3v9" />
                <path d="m6.5 9 3.5 3.5L13.5 9" />
                <path d="M3 16.5h14" />
              </svg>
              <span>{t("create.downloadPackage")}</span>
            </button>
            <button
              type="button"
              className="success-download-action"
              onClick={startNewRecord}
            >
              <span aria-hidden="true">＋</span>
              <span>{t("home.createCta")}</span>
            </button>
          </div>
        </div>

        <details className="success-details">
          <summary>{t("create.openDetails")}</summary>

          <div className="success-details-body">
            <section className="success-detail-section">
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
            </section>

            <section className="success-detail-section">
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
            </section>

            <section className="success-detail-section success-message-section">
              <span className="share-label">{t("create.shareMessageLabel")}</span>
              <div className="success-message-card">
                <p className="share-message">{shareMessage}</p>
                <button
                  type="button"
                  className="secondary success-message-copy"
                  onClick={onCopyShareMessage}
                >
                  {t("create.copyShareMessage")}
                </button>
              </div>
            </section>

            <div className="success-detail-utility-row">
              <button
                type="button"
                className="secondary success-utility-action"
                onClick={onToggleQr}
                aria-expanded={showShareQr}
                aria-controls="create-handoff-qr"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <rect x="2.5" y="2.5" width="5" height="5" rx="0.5" />
                  <rect x="12.5" y="2.5" width="5" height="5" rx="0.5" />
                  <rect x="2.5" y="12.5" width="5" height="5" rx="0.5" />
                  <path d="M12.5 12.5h2v2h-2zM15.5 15.5h2v2h-2zM15.5 12.5h2" />
                </svg>
                <span>{t(showShareQr ? "create.hideQr" : "create.showQr")}</span>
              </button>

              <a
                className="success-utility-link"
                href={package_.verificationUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>{t("nav.verify")}</span>
                <span aria-hidden="true">↗</span>
              </a>
            </div>

            {showShareQr && (
              <div className="handoff-qr-panel success-detail-qr" id="create-handoff-qr">
                <QrCode value={handoffUrl} label={t("create.qrLabel")} />
                <p>{t("create.qrWarning")}</p>
              </div>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
