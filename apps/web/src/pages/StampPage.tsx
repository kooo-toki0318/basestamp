import { useEffect, useState } from "react";
import { hexToBytes, type Hex } from "viem";
import { useI18n } from "../i18n-context";
import { HandoffStory } from "../components/HandoffStory";
import { localeTag } from "../locale";
import { calculateFileCommitment } from "../lib/commitment-worker";
import {
  base64UrlToBytes32,
  constantTimeEqual,
  hexToBytes32,
  MAX_FILE_SIZE_BYTES
} from "../lib/crypto";
import { BASE_SEPOLIA_DEPLOYMENT } from "../lib/deployment";
import {
  readRegistryStamp,
  verifyPackageOnchain
} from "../lib/onchain";
import {
  cacheVerificationPackage,
  readCachedVerificationPackage,
  removeCachedVerificationPackage
} from "../local-package";
import type { RegistryStamp } from "../lib/registry";
import {
  MAX_PACKAGE_BYTES,
  formatUnixSeconds,
  parseVerificationPackage,
  type VerificationPackage
} from "../lib/verification-package";

type StampPageProperties = {
  stampId: Hex;
};

function shortHex(value: string): string {
  return value.slice(0, 10) + "…" + value.slice(-8);
}

export function StampPage({ stampId }: StampPageProperties) {
  const { locale, t } = useI18n();
  const [stamp, setStamp] = useState<RegistryStamp>();
  const [package_, setPackage] = useState<VerificationPackage>();
  const [file, setFile] = useState<File>();
  const [status, setStatus] = useState(t("stamp.status.loading"));
  const [match, setMatch] = useState<boolean>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void readRegistryStamp(stampId)
      .then(async (nextStamp) => {
        if (!active) return;
        setStamp(nextStamp);
        setStatus(t("stamp.status.loaded"));
        const cachedSource = readCachedVerificationPackage(stampId);
        if (cachedSource === undefined) return;
        setBusy(true);
        try {
          const parsed = await parseVerificationPackage(cachedSource);
          const verifiedStamp = await verifyPackageOnchain(parsed);
          setStamp(verifiedStamp);
          setPackage(parsed);
          setStatus(t("stamp.status.restored"));
        } catch {
          setStatus(t("stamp.status.restoreFailed"));
        } finally {
          setBusy(false);
        }
      })
      .catch(() => {
        if (!active) return;
        setStatus(t("stamp.status.notFound"));
      });
    return () => {
      active = false;
    };
  }, [stampId, t]);

  async function loadPackage(packageFile: File | undefined): Promise<void> {
    setPackage(undefined);
    setFile(undefined);
    setMatch(undefined);
    if (packageFile === undefined) return;
    if (packageFile.size > MAX_PACKAGE_BYTES) {
      setStatus(t("stamp.status.packageTooLarge"));
      return;
    }

    setBusy(true);
    try {
      const parsed = await parseVerificationPackage(await packageFile.text());
      if (parsed.stampId !== stampId) {
        throw new Error(t("stamp.status.idMismatch"));
      }
      const verifiedStamp = await verifyPackageOnchain(parsed);
      setStamp(verifiedStamp);
      setPackage(parsed);
      cacheVerificationPackage(parsed);
      setStatus(t("stamp.status.packageVerified"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("stamp.status.packageFailed"));
    } finally {
      setBusy(false);
    }
  }

  function restartVerification(): void {
    removeCachedVerificationPackage(stampId);
    window.location.replace("/verify#verify-json");
  }

  async function verifyFile(): Promise<void> {
    if (file === undefined || package_ === undefined || stamp === undefined) {
      return;
    }
    setBusy(true);
    setMatch(undefined);
    try {
      if (file.size !== package_.commitment.fileSize) {
        setMatch(false);
        setStatus(t("stamp.status.fileSizeMismatch"));
        return;
      }
      const result = await calculateFileCommitment(
        file,
        base64UrlToBytes32(package_.commitment.contentSalt),
        (workerStatus) => {
          setStatus(
            workerStatus === "reading"
              ? t("stamp.status.reading")
              : t("stamp.status.recalculating")
          );
        }
      );
      const packageMatch = constantTimeEqual(
        hexToBytes32(result.contentCommitment),
        hexToBytes32(package_.commitment.contentCommitment)
      );
      const registryMatch = constantTimeEqual(
        hexToBytes(result.contentCommitment),
        hexToBytes(stamp.contentCommitment)
      );
      const nextMatch = packageMatch && registryMatch;
      setMatch(nextMatch);
      setStatus(
        nextMatch
          ? t("stamp.status.match")
          : t("stamp.status.noMatch")
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("stamp.status.localFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="shell workspace">
      <div className="workspace-heading">
        <p className="eyebrow">{t("stamp.eyebrow")}</p>
        <h1>{t("stamp.title")}</h1>
        <p className="lede">{t("stamp.lede")}</p>
      </div>

      <HandoffStory compact activeRole="verify" />

      <div className="flow-grid">
        <section className="panel">
          <span className="step-label">{t("stamp.step1")}</span>
          <dl className="technical-list">
            <div><dt>{t("stamp.id")}</dt><dd title={stampId}>{shortHex(stampId)}</dd></div>
            <div><dt>{t("stamp.registry")}</dt><dd title={BASE_SEPOLIA_DEPLOYMENT.registryAddress}>{shortHex(BASE_SEPOLIA_DEPLOYMENT.registryAddress)}</dd></div>
            {stamp !== undefined && (
              <>
                <div><dt>{t("stamp.creator")}</dt><dd title={stamp.creator}>{shortHex(stamp.creator)}</dd></div>
                <div><dt>{t("stamp.created")}</dt><dd>{formatUnixSeconds(stamp.createdAt)}</dd></div>
                <div><dt>{t("stamp.commitment")}</dt><dd title={stamp.contentCommitment}>{shortHex(stamp.contentCommitment)}</dd></div>
              </>
            )}
          </dl>
          <a
            href={
              BASE_SEPOLIA_DEPLOYMENT.explorerUrl +
              "/address/" +
              BASE_SEPOLIA_DEPLOYMENT.registryAddress
            }
            target="_blank"
            rel="noreferrer"
          >
            {t("stamp.openExplorer")}
          </a>
        </section>

        <section className="panel">
          <span className="step-label">{t("stamp.step2")}</span>
          {package_ === undefined ? (
            <>
              <label className="field">
                <span>{t("stamp.packageLabel")}</span>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) =>
                    void loadPackage(event.target.files?.[0])
                  }
                  disabled={busy || stamp === undefined}
                />
              </label>
              <p className="muted">{t("stamp.untrustedNotice")}</p>
            </>
          ) : (
            <div className="package-loaded">
              <span className="package-loaded-icon" aria-hidden="true">✓</span>
              <strong>{t("stamp.packageLoadedTitle")}</strong>
              <p className="muted">{t("stamp.packageLoadedBody")}</p>
              <button
                type="button"
                className="secondary"
                onClick={restartVerification}
                disabled={busy}
              >
                {t("stamp.replacePackage")}
              </button>
            </div>
          )}
        </section>

        <section className="panel">
          <span className="step-label">{t("stamp.step3")}</span>
          <label className="field">
            <span>{t("stamp.fileLabel")}</span>
            <input
              type="file"
              onChange={(event) => {
                const nextFile = event.target.files?.[0];
                setMatch(undefined);
                if (
                  nextFile !== undefined &&
                  nextFile.size <= MAX_FILE_SIZE_BYTES
                ) {
                  setFile(nextFile);
                } else {
                  setFile(undefined);
                  if (nextFile !== undefined) {
                    setStatus(t("stamp.status.fileTooLarge"));
                  }
                }
              }}
              disabled={busy || package_ === undefined}
            />
          </label>
          <button
            type="button"
            onClick={() => void verifyFile()}
            disabled={busy || file === undefined || package_ === undefined}
          >
            {t("stamp.verifyLocally")}
          </button>
          {match !== undefined && (
            <div
              className={
                match
                  ? "verification-result success"
                  : "verification-result failure"
              }
              aria-label={match ? t("stamp.match") : t("stamp.noMatch")}
            >
              <div className="verification-result-heading">
                <span aria-hidden="true">{match ? "✓" : "×"}</span>
                <h3>
                  {t(match ? "stamp.matchTitle" : "stamp.noMatchTitle")}
                </h3>
              </div>
              <p>
                {t(match ? "stamp.matchBody" : "stamp.noMatchBody")}
              </p>
              {match && package_ !== undefined && stamp !== undefined && (
                <>
                  <strong className="result-summary-label">
                    {t("stamp.resultSummary")}
                  </strong>
                  <dl className="result-summary">
                    <div>
                      <dt>{t("stamp.resultCreated")}</dt>
                      <dd>{formatUnixSeconds(stamp.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>{t("stamp.resultCreator")}</dt>
                      <dd title={stamp.creator}>{shortHex(stamp.creator)}</dd>
                    </div>
                    <div>
                      <dt>{t("stamp.resultFileSize")}</dt>
                      <dd>
                        {package_.commitment.fileSize.toLocaleString(
                          localeTag(locale)
                        )}{" "}
                        {t("common.bytes")}
                      </dd>
                    </div>
                  </dl>
                </>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="notice">{t("stamp.boundary")}</div>
      <p className="status prominent" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
