import { useState } from "react";
import { useI18n } from "../i18n-context";
import { HandoffStory } from "../components/HandoffStory";
import { cacheVerificationPackage } from "../local-package";
import {
  MAX_PACKAGE_BYTES,
  parseVerificationPackage
} from "../lib/verification-package";

export function VerifyStartPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState(t("verifyStart.status.choose"));
  const [busy, setBusy] = useState(false);

  async function beginVerification(packageFile: File | undefined): Promise<void> {
    if (packageFile === undefined) return;
    if (packageFile.size > MAX_PACKAGE_BYTES) {
      setStatus(t("verifyStart.status.tooLarge"));
      return;
    }

    setBusy(true);
    setStatus(t("verifyStart.status.checking"));
    try {
      const package_ = await parseVerificationPackage(await packageFile.text());
      cacheVerificationPackage(package_);
      window.location.assign("/stamps/" + package_.stampId);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : t("verifyStart.status.failed")
      );
      setBusy(false);
    }
  }

  return (
    <section className="shell workspace">
      <div className="workspace-heading">
        <p className="eyebrow">{t("verifyStart.eyebrow")}</p>
        <h1>{t("verifyStart.title")}</h1>
        <p className="lede">{t("verifyStart.lede")}</p>
      </div>

      <HandoffStory compact activeRole="verify" />

      <div className="handoff-grid">
        <section className="panel">
          <span className="step-label">{t("verifyStart.step1")}</span>
          <label className="field">
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

        <section className="panel">
          <span className="step-label">{t("verifyStart.needsTitle")}</span>
          <ol className="handoff-list">
            <li>{t("verifyStart.need1")}</li>
            <li>{t("verifyStart.need2")}</li>
            <li>{t("verifyStart.need3")}</li>
          </ol>
        </section>
      </div>

      <p className="status prominent" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
