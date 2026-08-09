import { useState } from "react";
import { cacheVerificationPackage } from "../local-package";
import {
  MAX_PACKAGE_BYTES,
  parseVerificationPackage
} from "../lib/verification-package";

export function VerifyStartPage() {
  const [status, setStatus] = useState(
    "Choose the BaseStamp JSON received with the original file."
  );
  const [busy, setBusy] = useState(false);

  async function beginVerification(packageFile: File | undefined): Promise<void> {
    if (packageFile === undefined) return;
    if (packageFile.size > MAX_PACKAGE_BYTES) {
      setStatus("Verification package exceeds the 64 KiB limit.");
      return;
    }

    setBusy(true);
    setStatus("Checking the verification package…");
    try {
      const package_ = await parseVerificationPackage(await packageFile.text());
      cacheVerificationPackage(package_);
      window.location.assign("/stamps/" + package_.stampId);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Verification package could not be opened."
      );
      setBusy(false);
    }
  }

  return (
    <section className="shell workspace">
      <div className="workspace-heading">
        <p className="eyebrow">Verify a handoff · Base Sepolia</p>
        <h1>Check a file you received.</h1>
        <p className="lede">
          Start with the BaseStamp JSON supplied by the sender. The app reads its
          stamp ID, checks the approved Registry, and then compares the original
          file locally in this browser.
        </p>
      </div>

      <div className="handoff-grid">
        <section className="panel">
          <span className="step-label">1 · Open verification package</span>
          <label className="field">
            <span>BaseStamp JSON, maximum 64 KiB</span>
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) =>
                void beginVerification(event.target.files?.[0])
              }
              disabled={busy}
            />
          </label>
          <p className="muted">
            The JSON contains the private comparison salt. It stays in this tab
            and is not uploaded to BaseStamp.
          </p>
        </section>

        <section className="panel">
          <span className="step-label">What the recipient needs</span>
          <ol className="handoff-list">
            <li>The downloaded BaseStamp JSON</li>
            <li>The candidate original file</li>
            <li>This web app—no wallet connection is required</li>
          </ol>
        </section>
      </div>

      <p className="status prominent" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
