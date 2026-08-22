import { useEffect, useMemo, useState } from "react";
import {
  getAddress,
  hexToBytes,
  isAddressEqual,
  type Address,
  type Hex
} from "viem";
import type { Session } from "../auth-types";
import { postJson } from "../api-client";
import { HandoffStory } from "../components/HandoffStory";
import { QrCode } from "../components/QrCode";
import { readCapturedHandoffFragment } from "../handoff-fragment";
import { useI18n } from "../i18n-context";
import { calculateFileCommitment } from "../lib/commitment-worker";
import {
  bytes32ToBase64Url,
  constantTimeEqual,
  MAX_FILE_SIZE_BYTES
} from "../lib/crypto";
import { getDeployment } from "../lib/deployment";
import {
  HANDOFF_PRIMARY_TYPE,
  HANDOFF_RECEIPT_TYPES,
  HANDOFF_STATEMENT,
  createHandoffUrl,
  parseHandoffChallenge,
  parseHandoffReceipt,
  parseHandoffVerification,
  serializeHandoffReceipt,
  type HandoffChallenge,
  type HandoffReceipt
} from "../lib/handoff";
import { verifyHandoffReceipt } from "../lib/handoff-receipt";
import {
  getBaseNetwork,
  type SupportedChainId
} from "../lib/networks";
import { readRegistryStamp } from "../lib/onchain";
import { createHandoffPath } from "../lib/routes";
import { formatUnixSeconds } from "../lib/verification-package";
import type { RegistryStamp } from "../lib/registry";

type HandoffPageProperties = {
  chainId: SupportedChainId;
  stampId: Hex;
  address: Address | undefined;
  walletChainId: number | undefined;
  selectedChainId: SupportedChainId;
  session: Session;
  authBusy: boolean;
  baseSignInAvailable: boolean;
  browserSignInAvailable: boolean;
  onSignInBase: () => void;
  onSignInBrowser: () => void;
  onAuthenticate: () => void;
  onSelectNetwork: () => void;
  onEnsureNetwork: () => Promise<void>;
  onSignTypedData: (challenge: HandoffChallenge) => Promise<Hex>;
};

function shortHex(value: string): string {
  return value.slice(0, 10) + "…" + value.slice(-8);
}

function downloadReceipt(receipt: HandoffReceipt): void {
  const blob = new Blob([serializeHandoffReceipt(receipt)], {
    type: "application/json;charset=utf-8"
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download =
    "basestamp-handoff-" + receipt.message.stampId.slice(2, 14) + ".json";
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

export function HandoffPage({
  chainId,
  stampId,
  address,
  walletChainId,
  selectedChainId,
  session,
  authBusy,
  baseSignInAvailable,
  browserSignInAvailable,
  onSignInBase,
  onSignInBrowser,
  onAuthenticate,
  onSelectNetwork,
  onEnsureNetwork,
  onSignTypedData
}: HandoffPageProperties) {
  const { t } = useI18n();
  const deployment = getDeployment(chainId);
  const routeNetwork = getBaseNetwork(chainId);
  const fragment = useMemo(
    () => readCapturedHandoffFragment(stampId),
    [stampId]
  );
  const [stamp, setStamp] = useState<RegistryStamp>();
  const [file, setFile] = useState<File>();
  const [match, setMatch] = useState<boolean>();
  const [receipt, setReceipt] = useState<HandoffReceipt>();
  const [busy, setBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [status, setStatus] = useState(t("handoffPage.status.loading"));

  const shareUrl =
    fragment.status === "valid"
      ? createHandoffUrl(
          window.location.origin,
          stampId,
          bytes32ToBase64Url(fragment.contentSalt),
          chainId
        )
      : undefined;
  const authenticatedForReceipt =
    session.authenticated &&
    address !== undefined &&
    isAddressEqual(getAddress(session.walletAddress), address) &&
    session.chainId === chainId &&
    walletChainId === chainId &&
    selectedChainId === chainId;

  useEffect(() => {
    let active = true;
    void readRegistryStamp(stampId, deployment)
      .then((nextStamp) => {
        if (!active) return;
        setStamp(nextStamp);
        setStatus(
          fragment.status === "valid"
            ? t("handoffPage.status.ready")
            : t(
                fragment.status === "invalid"
                  ? "handoffPage.status.invalidLink"
                  : "handoffPage.status.missingKey"
              )
        );
      })
      .catch(() => {
        if (active) setStatus(t("handoffPage.status.notFound"));
      });
    return () => {
      active = false;
    };
  }, [deployment, fragment.status, stampId, t]);

  function chooseFile(nextFile: File | undefined): void {
    setMatch(undefined);
    setReceipt(undefined);
    if (nextFile === undefined) {
      setFile(undefined);
      return;
    }
    if (nextFile.size > MAX_FILE_SIZE_BYTES) {
      setFile(undefined);
      setStatus(t("handoffPage.status.fileTooLarge"));
      return;
    }
    setFile(nextFile);
    setStatus(t("handoffPage.status.fileReady"));
  }

  async function verifySelectedFile(): Promise<void> {
    if (
      file === undefined ||
      stamp === undefined ||
      fragment.status !== "valid"
    ) {
      return;
    }
    setBusy(true);
    setMatch(undefined);
    setReceipt(undefined);
    try {
      const result = await calculateFileCommitment(
        file,
        fragment.contentSalt,
        (workerStatus) => {
          setStatus(
            t(
              workerStatus === "reading"
                ? "handoffPage.status.reading"
                : "handoffPage.status.calculating"
            )
          );
        }
      );
      const nextMatch = constantTimeEqual(
        hexToBytes(result.contentCommitment),
        hexToBytes(stamp.contentCommitment)
      );
      setMatch(nextMatch);
      setStatus(
        t(
          nextMatch
            ? "handoffPage.status.match"
            : "handoffPage.status.noMatch"
        )
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : t("handoffPage.status.localFailed")
      );
    } finally {
      setBusy(false);
    }
  }

  async function createReceipt(): Promise<void> {
    if (
      match !== true ||
      stamp === undefined ||
      address === undefined ||
      !authenticatedForReceipt
    ) {
      return;
    }

    setBusy(true);
    setReceipt(undefined);
    try {
      setStatus(t("handoffPage.status.challenge"));
      const challengeValue = await postJson<unknown>(
        "/api/handoff/challenge",
        { chainId, stampId },
        t
      );
      const challenge = parseHandoffChallenge(
        challengeValue,
        stampId,
        stamp.contentCommitment,
        Math.floor(Date.now() / 1000),
        chainId
      );

      setStatus(t("handoffPage.status.signing"));
      const signature = await onSignTypedData(challenge);

      setStatus(t("handoffPage.status.verifyingSignature"));
      const verificationValue = await postJson<unknown>(
        "/api/handoff/verify",
        {
          ackNonce: challenge.message.ackNonce,
          signature
        },
        t
      );
      const verification = parseHandoffVerification(
        verificationValue,
        chainId
      );
      const nextReceipt: HandoffReceipt = {
        schemaVersion: 1,
        type: "BaseStampHandoffReceipt",
        primaryType: HANDOFF_PRIMARY_TYPE,
        domain: challenge.domain,
        types: HANDOFF_RECEIPT_TYPES,
        message: challenge.message,
        signer: getAddress(address),
        signature,
        verificationMethod: "EIP-712",
        signatureValidation: verification.signatureValidation,
        verifiedAt: verification.verifiedAt,
        verification: verification.verification,
        verificationUrl:
          window.location.origin + createHandoffPath(chainId, stampId)
      };
      setReceipt(nextReceipt);
      downloadReceipt(nextReceipt);
      setStatus(t("handoffPage.status.receiptReady"));
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : t("handoffPage.status.receiptFailed")
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadReceipt(receiptFile: File | undefined): Promise<void> {
    if (receiptFile === undefined) return;
    if (receiptFile.size > 64 * 1024) {
      setStatus(t("handoffPage.status.receiptTooLarge"));
      return;
    }

    setBusy(true);
    try {
      const parsed = parseHandoffReceipt(
        await receiptFile.text(),
        window.location.origin
      );
      if (
        parsed.domain.chainId !== chainId ||
        parsed.message.stampId !== stampId
      ) {
        throw new Error(t("handoffPage.status.receiptStampMismatch"));
      }
      setStatus(t("handoffPage.status.recheckingReceipt"));
      await verifyHandoffReceipt(parsed);
      setReceipt(parsed);
      setStatus(t("handoffPage.status.receiptVerified"));
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : t("handoffPage.status.receiptInvalid")
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyShareUrl(): Promise<void> {
    if (shareUrl === undefined) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatus(t("handoffPage.status.linkCopied"));
    } catch {
      setStatus(t("handoffPage.status.linkCopyFailed"));
    }
  }

  async function shareHandoff(): Promise<void> {
    if (shareUrl === undefined) return;
    const share = Reflect.get(navigator, "share");
    if (typeof share !== "function") {
      await copyShareUrl();
      return;
    }
    try {
      await Reflect.apply(share, navigator, [{
        title: "BaseStamp",
        text: t("handoffPage.shareText"),
        url: shareUrl
      }]);
      setStatus(t("handoffPage.status.shared"));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus(t("handoffPage.status.shareCancelled"));
      } else {
        setStatus(t("handoffPage.status.shareFailed"));
      }
    }
  }

  return (
    <section className="shell workspace handoff-page">
      <div className="workspace-heading">
        <p className="eyebrow">
          {t("handoffPage.eyebrow", { network: routeNetwork.name })}
        </p>
        <h1>{t("handoffPage.title")}</h1>
        <p className="lede">{t("handoffPage.lede")}</p>
      </div>

      <HandoffStory compact activeRole="verify" activeStep={4} />

      <aside className="privacy-warning">
        <span className="privacy-warning-icon" aria-hidden="true">i</span>
        <div>
          <strong>{t("handoffPage.privacyTitle")}</strong>
          <p>{t("handoffPage.privacyBody")}</p>
        </div>
      </aside>

      {fragment.status !== "valid" && (
        <div className="verification-result failure" role="alert">
          <div className="verification-result-heading">
            <span aria-hidden="true">×</span>
            <h2>
              {t(
                fragment.status === "invalid"
                  ? "handoffPage.invalidLinkTitle"
                  : "handoffPage.missingKeyTitle"
              )}
            </h2>
          </div>
          <p>
            {t(
              fragment.status === "invalid"
                ? "handoffPage.invalidLinkBody"
                : "handoffPage.missingKeyBody"
            )}
          </p>
        </div>
      )}

      <div className="handoff-workspace-grid">
        <section className="panel handoff-record-card">
          <span className="step-label">{t("handoffPage.recordLabel")}</span>
          <h2>{t("handoffPage.recordTitle")}</h2>
          <dl className="technical-list">
            <div>
              <dt>{t("stamp.id")}</dt>
              <dd title={stampId}>{shortHex(stampId)}</dd>
            </div>
            <div>
              <dt>{t("stamp.registry")}</dt>
              <dd title={deployment.registryAddress}>
                {shortHex(deployment.registryAddress)}
              </dd>
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
              </>
            )}
          </dl>
        </section>

        <section className="panel handoff-file-card">
          <span className="step-label">{t("handoffPage.fileLabel")}</span>
          <h2>{t("handoffPage.fileTitle")}</h2>
          <label
            className="handoff-drop-zone"
            onDragOver={(event) => {
              event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              chooseFile(event.dataTransfer.files[0]);
            }}
          >
            <span className="handoff-drop-icon" aria-hidden="true">↓</span>
            <strong>{t("handoffPage.dropTitle")}</strong>
            <span>{t("handoffPage.dropBody")}</span>
            <input
              type="file"
              onChange={(event) => {
                chooseFile(event.target.files?.[0]);
              }}
              disabled={
                busy || stamp === undefined || fragment.status !== "valid"
              }
            />
          </label>
          {file !== undefined && (
            <p className="selected-file">
              <strong>{t("handoffPage.selectedFile")}</strong>
              <span>{file.name}</span>
            </p>
          )}
          <button
            type="button"
            onClick={() => void verifySelectedFile()}
            disabled={
              busy ||
              file === undefined ||
              stamp === undefined ||
              fragment.status !== "valid"
            }
          >
            {t("handoffPage.verifyFile")}
          </button>

          {match !== undefined && (
            <div
              className={
                match
                  ? "verification-result success"
                  : "verification-result failure"
              }
              role={match ? "status" : "alert"}
            >
              <div className="verification-result-heading">
                <span aria-hidden="true">{match ? "✓" : "×"}</span>
                <h3>
                  {t(
                    match
                      ? "handoffPage.matchTitle"
                      : "handoffPage.noMatchTitle"
                  )}
                </h3>
              </div>
              <p>
                {t(
                  match
                    ? "handoffPage.matchBody"
                    : "handoffPage.noMatchBody"
                )}
              </p>
            </div>
          )}
        </section>
      </div>

      {match === true && (
        <section className="panel handoff-receipt-card">
          <span className="step-label">{t("handoffPage.receiptLabel")}</span>
          <h2>{t("handoffPage.receiptTitle")}</h2>
          <p>
            {t("handoffPage.receiptIntro", {
              network: routeNetwork.name
            })}
          </p>

          {selectedChainId !== chainId ? (
            <button
              type="button"
              onClick={onSelectNetwork}
              disabled={authBusy}
            >
              {t("auth.switchTo", { network: routeNetwork.name })}
            </button>
          ) : address === undefined ? (
            <div className="handoff-auth-actions">
              <button
                type="button"
                onClick={onSignInBase}
                disabled={authBusy || !baseSignInAvailable}
              >
                {t("auth.signInBase")}
              </button>
              {browserSignInAvailable && (
                <button
                  type="button"
                  className="secondary"
                  onClick={onSignInBrowser}
                  disabled={authBusy}
                >
                  {t("auth.browserWallet")}
                </button>
              )}
            </div>
          ) : walletChainId !== chainId ? (
            <button
              type="button"
              onClick={() => void onEnsureNetwork()}
              disabled={authBusy}
            >
              {t("auth.switchTo", { network: routeNetwork.name })}
            </button>
          ) : !authenticatedForReceipt ? (
            <button
              type="button"
              onClick={onAuthenticate}
              disabled={authBusy}
            >
              {t("handoffPage.authenticateToSign")}
            </button>
          ) : (
            <>
              <div className="handoff-statement">
                <span>{t("handoffPage.statementLabel")}</span>
                <blockquote>{HANDOFF_STATEMENT}</blockquote>
              </div>
              <button
                type="button"
                onClick={() => void createReceipt()}
                disabled={busy}
              >
                {t("handoffPage.signReceipt")}
              </button>
            </>
          )}

          <div className="notice handoff-meaning">
            <strong>{t("handoffPage.meaningTitle")}</strong>
            <p>{t("handoffPage.meaningBody")}</p>
          </div>

          {receipt !== undefined && (
            <div className="receipt-ready">
              <div className="result-heading">
                <span className="result-check" aria-hidden="true">✓</span>
                <strong>{t("handoffPage.receiptReadyTitle")}</strong>
              </div>
              <p>{t("handoffPage.receiptReadyBody")}</p>
              <button
                type="button"
                onClick={() => {
                  downloadReceipt(receipt);
                }}
              >
                {t("handoffPage.downloadReceipt")}
              </button>
              <dl className="technical-list">
                <div>
                  <dt>{t("handoffPage.signer")}</dt>
                  <dd title={receipt.signer}>{shortHex(receipt.signer)}</dd>
                </div>
                <div>
                  <dt>{t("handoffPage.validation")}</dt>
                  <dd>{receipt.signatureValidation}</dd>
                </div>
                <div>
                  <dt>{t("handoffPage.verifiedBlock")}</dt>
                  <dd>{receipt.verification.blockNumber}</dd>
                </div>
              </dl>
            </div>
          )}
        </section>
      )}

      {shareUrl !== undefined && (
        <section className="panel handoff-share-card">
          <span className="step-label">{t("handoffPage.shareLabel")}</span>
          <h2>{t("handoffPage.shareTitle")}</h2>
          <p>{t("handoffPage.shareWarning")}</p>
          <div className="handoff-share-actions">
            <button type="button" onClick={() => void copyShareUrl()}>
              {t("handoffPage.copyPrivateLink")}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void shareHandoff()}
            >
              {t("handoffPage.webShare")}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setShowQr((value) => !value);
              }}
              aria-expanded={showQr}
            >
              {t(showQr ? "handoffPage.hideQr" : "handoffPage.showQr")}
            </button>
          </div>
          {showQr && (
            <div className="handoff-qr-panel">
              <QrCode value={shareUrl} label={t("handoffPage.qrLabel")} />
              <p>{t("handoffPage.qrWarning")}</p>
            </div>
          )}
        </section>
      )}

      <details className="panel handoff-recheck-card">
        <summary>{t("handoffPage.recheckTitle")}</summary>
        <p>{t("handoffPage.recheckIntro")}</p>
        <label className="field">
          <span>{t("handoffPage.receiptFileLabel")}</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              void loadReceipt(event.target.files?.[0]);
            }}
            disabled={busy}
          />
        </label>
        <p className="muted">{t("handoffPage.observationNotice")}</p>
      </details>

      <p className="status prominent" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
