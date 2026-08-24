import { useEffect, useState } from "react";
import { useI18n } from "../i18n-context";
import { cacheVerificationPackage } from "../local-package";
import { createStampPath } from "../lib/routes";
import {
  MAX_PACKAGE_BYTES,
  parseVerificationPackage
} from "../lib/verification-package";

export function VerifyStartPage() {
  const { t } = useI18n();
  const initialStatus = t("verifyStart.status.choose");
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (window.location.hash !== "#verify-json") return;

    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById("verify-json")
        ?.scrollIntoView({ block: "center" });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  async function beginVerification(
    packageFile: File | undefined
  ): Promise<void> {
    if (packageFile === undefined) return;

    if (packageFile.size > MAX_PACKAGE_BYTES) {
      setStatus(t("verifyStart.status.tooLarge"));
      return;
    }

    setBusy(true);
    setStatus(t("verifyStart.status.checking"));

    try {
      const package_ = await parseVerificationPackage(
        await packageFile.text()
      );

      cacheVerificationPackage(package_);
      window.location.assign(
        createStampPath(package_.chainId, package_.stampId)
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : t("verifyStart.status.failed")
      );
      setBusy(false);
    }
  }

  const showStatus = busy || status !== initialStatus;
  const statusIsError = !busy && status !== initialStatus;

  return (
    <section className="shell workspace verify-start-page">
      <div className="workspace-heading">
        <p className="eyebrow">{t("verifyStart.eyebrow")}</p>
        <h1>{t("verifyStart.title")}</h1>
        <p className="lede">{t("verifyStart.lede")}</p>
      </div>

      {showStatus && (
        <div
          className={
            "verify-status feedback-status" +
            (busy ? " is-busy" : "") +
            (statusIsError ? " is-error" : "")
          }
          role={statusIsError ? "alert" : "status"}
          aria-live={statusIsError ? "assertive" : "polite"}
          aria-atomic="true"
        >
          <span className="feedback-status-dot" aria-hidden="true" />
          <p>{status}</p>
        </div>
      )}

      <section id="verify-json" className="panel verify-entry-panel">
        <ol className="create-journey verify-journey" aria-label={t("verifyStart.needsTitle")}>
          <li className="is-active">
            <span>1</span>
            <strong>{t("verifyStart.step1")}</strong>
          </li>
          <li>
            <span>2</span>
            <strong>{t("stamp.step3")}</strong>
          </li>
          <li>
            <span>3</span>
            <strong>{t("stamp.resultSummary")}</strong>
          </li>
        </ol>

        <span className="step-label">{t("verifyStart.step1")}</span>
        <label className="field verify-package-field">
          <span>{t("verifyStart.fileLabel")}</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) =>
              void beginVerification(event.target.files?.[0])
            }
            disabled={busy}
          />
        </label>
        <p className="muted">{t("verifyStart.saltNotice")}</p>
      </section>

      <details className="panel verify-help-panel">
        <summary>{t("verifyStart.needsTitle")}</summary>
        <ol className="handoff-list">
          <li>{t("verifyStart.need1")}</li>
          <li>{t("verifyStart.need2")}</li>
          <li>{t("verifyStart.need3")}</li>
        </ol>
      </details>
    </section>
  );
}
