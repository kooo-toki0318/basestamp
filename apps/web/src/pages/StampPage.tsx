import { useEffect, useState } from "react";
import { hexToBytes, type Hex } from "viem";
import { useI18n } from "../i18n-context";
import { localeTag } from "../locale";
import { calculateFileCommitment } from "../lib/commitment-worker";
import {
  base64UrlToBytes32,
  constantTimeEqual,
  hexToBytes32,
  MAX_FILE_SIZE_BYTES
} from "../lib/crypto";
import { getDeployment } from "../lib/deployment";
import { getBaseNetwork, type SupportedChainId } from "../lib/networks";
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
  chainId: SupportedChainId;
  stampId: Hex;
};

function shortHex(value: string): string {
  return value.slice(0, 10) + "…" + value.slice(-8);
}

export function StampPage({
  chainId,
  stampId
}: StampPageProperties) {
  const { locale, t } = useI18n();
  const deployment = getDeployment(chainId);
  const routeNetwork = getBaseNetwork(chainId);
  const [stamp, setStamp] = useState<RegistryStamp>();
  const [package_, setPackage] = useState<VerificationPackage>();
  const [file, setFile] = useState<File>();
  const [status, setStatus] = useState(t("stamp.status.loading"));
  const [match, setMatch] = useState<boolean>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    void readRegistryStamp(stampId, deployment)
      .then(async (nextStamp) => {
        if (!active) return;

        setStamp(nextStamp);
        setStatus(t("stamp.status.loaded"));

        const cachedSource = readCachedVerificationPackage(stampId);
        if (cachedSource === undefined) return;

        setBusy(true);

        try {
          const parsed = await parseVerificationPackage(cachedSource);

          if (
            parsed.chainId !== chainId ||
            parsed.stampId !== stampId
          ) {
            throw new Error("Cached verification package does not match route.");
          }

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
  }, [chainId, deployment, stampId, t]);

  async function loadPackage(
    packageFile: File | undefined
  ): Promise<void> {
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
      const parsed = await parseVerificationPackage(
        await packageFile.text()
      );

      if (
        parsed.chainId !== chainId ||
        parsed.stampId !== stampId
      ) {
        throw new Error(t("stamp.status.idMismatch"));
      }

      const verifiedStamp = await verifyPackageOnchain(parsed);

      setStamp(verifiedStamp);
      setPackage(parsed);
      cacheVerificationPackage(parsed);
      setStatus(t("stamp.status.packageVerified"));
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : t("stamp.status.packageFailed")
      );
    } finally {
      setBusy(false);
    }
  }

  function restartVerification(): void {
    removeCachedVerificationPackage(stampId);
    window.location.replace("/verify#verify-json");
  }

  async function verifyFile(): Promise<void> {
    if (
      file === undefined ||
      package_ === undefined ||
      stamp === undefined
    ) {
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
      setStatus(
        error instanceof Error
          ? error.message
          : t("stamp.status.localFailed")
      );
    } finally {
      setBusy(false);
    }
  }

  const verificationStep: 1 | 2 | 3 =
    package_ === undefined ? 1 : match === undefined ? 2 : 3;

  return (
    <section className="shell workspace verify-file-page">
      <div className="workspace-heading">
        <p className="eyebrow">
          {t("stamp.eyebrow", { network: routeNetwork.name })}
        </p>
        <h1>{t("stamp.title")}</h1>
        <p className="lede">{t("stamp.lede", { network: routeNetwork.name })}</p>
      </div>

      <p className="status prominent verify-status" role="status" aria-live="polite">
        {status}
      </p>

      <section className="panel verify-main-panel">
        <ol className="create-journey verify-journey" aria-label={t("verifyStart.needsTitle")}>
          <li className={verificationStep === 1 ? "is-active" : "is-complete"}>
            <span>{verificationStep > 1 ? "✓" : "1"}</span>
            <strong>{t("verifyStart.step1")}</strong>
          </li>
          <li
            className={
              verificationStep === 2
                ? "is-active"
                : verificationStep > 2
                  ? "is-complete"
                  : undefined
            }
          >
            <span>{verificationStep > 2 ? "✓" : "2"}</span>
            <strong>{t("stamp.step3")}</strong>
          </li>
          <li className={verificationStep === 3 ? "is-active" : undefined}>
            <span>3</span>
            <strong>{t("stamp.resultSummary")}</strong>
          </li>
        </ol>

        {package_ === undefined ? (
          <>
            <span className="step-label">{t("stamp.step2")}</span>
            <label className="field verify-package-field">
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
          <>
            <div className="verify-info-ready">
              <span aria-hidden="true">✓</span>
              <div>
                <strong>{t("stamp.packageLoadedTitle")}</strong>
                <p>{t("stamp.packageLoadedBody")}</p>
              </div>
              <button
                type="button"
                className="secondary compact"
                onClick={restartVerification}
                disabled={busy}
              >
                {t("stamp.replacePackage")}
              </button>
            </div>

            <span className="step-label">{t("stamp.step3")}</span>
            <label className="field verify-file-field">
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
                disabled={busy}
              />
            </label>
            <button
              type="button"
              className="verify-file-action"
              onClick={() => void verifyFile()}
              disabled={busy || file === undefined}
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
                  <h3>{t(match ? "stamp.matchTitle" : "stamp.noMatchTitle")}</h3>
                </div>
                <p>{t(match ? "stamp.matchBody" : "stamp.noMatchBody")}</p>

                {match && stamp !== undefined && (
                  <dl className="result-summary verify-result-details">
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
                        {package_.commitment.fileSize.toLocaleString(localeTag(locale))}{" "}
                        {t("common.bytes")}
                      </dd>
                    </div>
                  </dl>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <details className="panel verify-record-details">
        <summary>{t("stamp.step1")}</summary>
        <dl className="technical-list">
          <div>
            <dt>{t("stamp.id")}</dt>
            <dd title={stampId}>{shortHex(stampId)}</dd>
          </div>
          <div>
            <dt>{t("stamp.registry")}</dt>
            <dd title={deployment.registryAddress}>{shortHex(deployment.registryAddress)}</dd>
          </div>
          {stamp !== undefined && (
            <>
              <div>
                <dt>{t("stamp.creator")}</dt>
                <dd title={stamp.creator}>{shortHex(stamp.creator)}</dd>
              </div>
              <div>
                <dt>{t("stamp.created")}</dt>
                <dd>{formatUnixSeconds(stamp.createdAt)}</dd>
              </div>
              <div>
                <dt>{t("stamp.commitment")}</dt>
                <dd title={stamp.contentCommitment}>{shortHex(stamp.contentCommitment)}</dd>
              </div>
            </>
          )}
        </dl>
        <a
          href={deployment.explorerUrl + "/address/" + deployment.registryAddress}
          target="_blank"
          rel="noreferrer"
        >
          {t("stamp.openExplorer")}
        </a>
      </details>

      <p className="verify-boundary-note">{t("stamp.boundary")}</p>
    </section>
  );
}
