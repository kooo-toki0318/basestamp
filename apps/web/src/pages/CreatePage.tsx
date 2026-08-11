import { useEffect, useState } from "react";
import {
  bytesToHex,
  getAddress,
  isAddressEqual,
  type Address,
  type Hex
} from "viem";
import { useWriteContract } from "wagmi";
import type { Session } from "../auth-types";
import { useI18n, type MessageKey } from "../i18n-context";
import { localeTag } from "../locale";
import { FilePreview } from "../components/FilePreview";
import { HandoffStory } from "../components/HandoffStory";
import { QrCode } from "../components/QrCode";
import {
  getCreateConfirmationState,
  getCreateWalletState
} from "../create-wallet-state";
import { getCreateHandoffStep } from "../handoff-role";
import { calculateFileCommitment } from "../lib/commitment-worker";
import {
  bytes32ToBase64Url,
  MAX_FILE_SIZE_BYTES,
  randomBytes32
} from "../lib/crypto";
import { BASE_SEPOLIA_DEPLOYMENT } from "../lib/deployment";
import { createHandoffUrl } from "../lib/handoff";
import {
  cacheCreatedVerificationPackage,
  readLatestCreatedVerificationPackage
} from "../local-package";
import {
  CONTENT_TYPES,
  PURPOSES,
  hashMetadata,
  type ContentType,
  type Purpose,
  type StampMetadata
} from "../lib/metadata";
import {
  getBaseNetwork,
  type SupportedChainId
} from "../lib/networks";
import { baseSepoliaPublicClient } from "../lib/onchain";
import { deriveStampId, registryAbi } from "../lib/registry";
import {
  formatUnixSeconds,
  serializeVerificationPackage,
  parseVerificationPackage,
  type VerificationPackage
} from "../lib/verification-package";

type PreparedStamp = {
  fileSize: number;
  contentSalt: Uint8Array;
  stampNonce: Uint8Array;
  contentCommitment: Hex;
  metadata: StampMetadata;
  metadataHash: Hex;
};

type PendingConfirmation = {
  creator: Address;
  expectedStampId: Hex;
  prepared: PreparedStamp;
  searchFromBlock: bigint;
  submittedHash: Hex;
};

const CONFIRMATION_WINDOW_MS = 5 * 60 * 1000;
const CONFIRMATION_POLL_INTERVAL_MS = 4000;

type ConfirmedRegistryRecord = {
  blockHash: Hex;
  blockNumber: bigint;
  blockTimestamp: bigint;
  createdAt: bigint;
  transactionHash: Hex;
};

type CreatePageProperties = {
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
  onEnsureNetwork: () => Promise<void>;
};

const PURPOSE_LABEL_KEYS = {
  deliverable: "metadata.purpose.deliverable",
  release: "metadata.purpose.release",
  report: "metadata.purpose.report",
  specification: "metadata.purpose.specification",
  "meeting-record": "metadata.purpose.meetingRecord"
} satisfies Record<Purpose, MessageKey>;

function shortHex(value: string): string {
  return value.slice(0, 10) + "…" + value.slice(-8);
}

function shortAddress(value: Address): string {
  return value.slice(0, 6) + "…" + value.slice(-4);
}

function downloadPackage(package_: VerificationPackage): void {
  const blob = new Blob([serializeVerificationPackage(package_)], {
    type: "application/json;charset=utf-8"
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = "basestamp-" + package_.stampId.slice(2, 14) + ".json";
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitForAutomaticConfirmation(
  confirmation: PendingConfirmation,
  eventMismatchMessage: string
): Promise<ConfirmedRegistryRecord> {
  const deadline = Date.now() + CONFIRMATION_WINDOW_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    let events;
    try {
      events = await baseSepoliaPublicClient.getContractEvents({
        address: BASE_SEPOLIA_DEPLOYMENT.registryAddress,
        abi: registryAbi,
        eventName: "StampCreated",
        args: { stampId: confirmation.expectedStampId },
        fromBlock: confirmation.searchFromBlock,
        strict: true
      });
    } catch (error) {
      lastError = error;
      await delay(CONFIRMATION_POLL_INTERVAL_MS);
      continue;
    }

    const event = events[0];
    if (event === undefined) {
      await delay(CONFIRMATION_POLL_INTERVAL_MS);
      continue;
    }
    if (
      !isAddressEqual(event.args.creator, confirmation.creator) ||
      event.args.contentCommitment !==
        confirmation.prepared.contentCommitment ||
      event.args.metadataHash !== confirmation.prepared.metadataHash
    ) {
      throw new Error(eventMismatchMessage);
    }

    try {
      const block = await baseSepoliaPublicClient.getBlock({
        blockNumber: event.blockNumber
      });
      return {
        blockHash: event.blockHash,
        blockNumber: event.blockNumber,
        blockTimestamp: block.timestamp,
        createdAt: event.args.createdAt,
        transactionHash: event.transactionHash
      };
    } catch (error) {
      lastError = error;
      await delay(CONFIRMATION_POLL_INTERVAL_MS);
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error("Transaction confirmation timed out.");
}

export function CreatePage({
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
  onEnsureNetwork
}: CreatePageProperties) {
  const { locale, t } = useI18n();
  const [file, setFile] = useState<File>();
  const [contentType, setContentType] =
    useState<ContentType>("application/pdf");
  const [purpose, setPurpose] = useState<Purpose>("deliverable");
  const [prepared, setPrepared] = useState<PreparedStamp>();
  const [package_, setPackage] = useState<VerificationPackage>();
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation>();
  const [status, setStatus] = useState(t("create.status.chooseFile"));
  const [busy, setBusy] = useState(false);
  const [showShareQr, setShowShareQr] = useState(false);
  const { mutateAsync: writeContractAsync } = useWriteContract();
  const selectedNetwork = getBaseNetwork(selectedChainId);
  const registryAvailable = selectedChainId === 84532;
  useEffect(() => {
    const source = readLatestCreatedVerificationPackage();
    if (source === undefined) return;
    void parseVerificationPackage(source)
      .then((latestPackage) => {
        setPackage(latestPackage);
        setStatus(t("create.status.latestRestored"));
      })
      .catch(() => {
        // Invalid or expired tab state is ignored.
      });
  }, [t]);

  const authenticatedAddress =
    session.authenticated && address !== undefined
      ? isAddressEqual(getAddress(session.walletAddress), address) &&
        session.chainId === selectedChainId
      : false;
  const walletState = getCreateWalletState(
    address !== undefined,
    walletChainId,
    selectedChainId,
    authenticatedAddress
  );
  const readyToRecord = walletState === "ready";
  const confirmationState = getCreateConfirmationState(
    pendingConfirmation !== undefined,
    busy
  );

  const handoffUrl =
    package_ === undefined
      ? ""
      : createHandoffUrl(
          window.location.origin,
          package_.stampId,
          package_.commitment.contentSalt
        );
  const shareMessage =
    package_ === undefined
      ? ""
      : t("create.shareMessage", { url: handoffUrl });

  async function switchToSelectedNetwork(): Promise<void> {
    setBusy(true);
    setStatus(
      t("create.status.switchingNetwork", { network: selectedNetwork.name })
    );
    try {
      await onEnsureNetwork();
      setStatus(
        t("create.status.networkReady", { network: selectedNetwork.name })
      );
    } catch {
      setStatus(
        t("create.status.networkSwitchFailed", {
          network: selectedNetwork.name
        })
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyText(
    value: string,
    successKey: MessageKey,
    failureKey: MessageKey
  ): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(t(successKey));
    } catch {
      setStatus(t(failureKey));
    }
  }

  async function shareHandoff(): Promise<void> {
    if (handoffUrl === "") return;
    const share = Reflect.get(navigator, "share");
    if (typeof share !== "function") {
      await copyText(
        handoffUrl,
        "create.status.linkCopied",
        "create.status.linkCopyFailed"
      );
      return;
    }
    try {
      await Reflect.apply(share, navigator, [{
        title: "BaseStamp",
        text: t("create.shareText"),
        url: handoffUrl
      }]);
      setStatus(t("create.status.shared"));
    } catch (error) {
      setStatus(
        error instanceof DOMException && error.name === "AbortError"
          ? t("create.status.shareCancelled")
          : t("create.status.shareFailed")
      );
    }
  }

  function chooseFile(nextFile: File | undefined): void {
    setPrepared(undefined);
    setPackage(undefined);
    if (nextFile === undefined) {
      setFile(undefined);
      setStatus(t("create.status.chooseFile"));
      return;
    }
    if (nextFile.size > MAX_FILE_SIZE_BYTES) {
      setFile(undefined);
      setStatus(t("create.status.fileTooLarge"));
      return;
    }
    setFile(nextFile);
    const detectedContentType = CONTENT_TYPES.find(
      (value) => value === nextFile.type
    );
    setContentType(detectedContentType ?? "application/octet-stream");
    setStatus(t("create.status.ready"));
  }

  async function prepare(): Promise<void> {
    if (file === undefined) return;
    setBusy(true);
    setPackage(undefined);
    try {
      const contentSalt = randomBytes32();
      const stampNonce = randomBytes32();
      const metadata: StampMetadata = {
        contentType,
        purpose,
        schemaVersion: 1
      };
      const [commitmentResult, metadataHash] = await Promise.all([
        calculateFileCommitment(file, contentSalt, (workerStatus) => {
          setStatus(
            workerStatus === "reading"
              ? t("create.status.reading")
              : t("create.status.calculating")
          );
        }),
        hashMetadata(metadata)
      ]);
      setPrepared({
        fileSize: commitmentResult.fileSize,
        contentSalt,
        stampNonce,
        contentCommitment: commitmentResult.contentCommitment,
        metadata,
        metadataHash
      });
      setStatus(t("create.status.valuesReady"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("create.status.preparationFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    if (!registryAvailable && pendingConfirmation === undefined) {
      setStatus(t("create.status.mainnetUnavailable"));
      return;
    }
    if (
      pendingConfirmation === undefined &&
      (prepared === undefined ||
        address === undefined ||
        !authenticatedAddress)
    ) {
      setStatus(t("create.status.signInRequired"));
      return;
    }

    setBusy(true);
    let activeConfirmation = pendingConfirmation;
    try {
      if (activeConfirmation === undefined) {
        if (prepared === undefined || address === undefined) {
          throw new Error(t("create.status.localRecordMissing"));
        }
        setStatus(
          t("create.status.checkingNetwork", {
            network: selectedNetwork.name
          })
        );
        try {
          await onEnsureNetwork();
        } catch {
          setStatus(
            t("create.status.networkSwitchFailed", {
              network: selectedNetwork.name
            })
          );
          return;
        }
        const stampNonceHex = bytesToHex(prepared.stampNonce);
        const expectedStampId = deriveStampId({
          chainId: BASE_SEPOLIA_DEPLOYMENT.chainId,
          registryAddress: BASE_SEPOLIA_DEPLOYMENT.registryAddress,
          creator: address,
          contentCommitment: prepared.contentCommitment,
          metadataHash: prepared.metadataHash,
          stampNonce: stampNonceHex
        });
        const searchFromBlock = await baseSepoliaPublicClient.getBlockNumber();

        setStatus(t("create.status.approveTransaction"));
        const submittedHash = await writeContractAsync({
          address: BASE_SEPOLIA_DEPLOYMENT.registryAddress,
          abi: registryAbi,
          functionName: "createStamp",
          args: [
            prepared.contentCommitment,
            prepared.metadataHash,
            stampNonceHex
          ],
          account: address,
          chainId: BASE_SEPOLIA_DEPLOYMENT.chainId
        });

        activeConfirmation = {
          creator: address,
          expectedStampId,
          prepared,
          searchFromBlock,
          submittedHash
        };
        setPendingConfirmation(activeConfirmation);
      }

      const {
        creator,
        expectedStampId,
        prepared: confirmedPrepared
      } = activeConfirmation;

      setStatus(t("create.status.waiting"));
      const confirmedRecord = await waitForAutomaticConfirmation(
        activeConfirmation,
        t("create.status.eventMismatch")
      );

      const nextPackage: VerificationPackage = {
        schemaVersion: 1,
        type: "BaseStampVerificationPackage",
        app: "BaseStamp",
        network: "base-sepolia",
        chainId: 84532,
        contractAddress: BASE_SEPOLIA_DEPLOYMENT.registryAddress,
        stampId: expectedStampId,
        transactionHash: confirmedRecord.transactionHash,
        blockNumber: Number(confirmedRecord.blockNumber),
        blockHash: confirmedRecord.blockHash,
        blockTimestamp: formatUnixSeconds(confirmedRecord.blockTimestamp),
        creator: getAddress(creator),
        createdAt: formatUnixSeconds(confirmedRecord.createdAt),
        commitment: {
          algorithm: "SHA-256",
          domain: "BaseStamp.Content.v1",
          fileSize: confirmedPrepared.fileSize,
          contentSalt: bytes32ToBase64Url(confirmedPrepared.contentSalt),
          contentCommitment: confirmedPrepared.contentCommitment
        },
        stampNonce: bytes32ToBase64Url(confirmedPrepared.stampNonce),
        metadata: confirmedPrepared.metadata,
        metadataHash: confirmedPrepared.metadataHash,
        verificationUrl:
          window.location.origin + "/stamps/" + expectedStampId
      };
      setPackage(nextPackage);
      cacheCreatedVerificationPackage(nextPackage);
      downloadPackage(nextPackage);
      setPendingConfirmation(undefined);
      setStatus(t("create.status.recorded"));
    } catch (error) {
      if (activeConfirmation !== undefined) {
        setStatus(
          t("create.status.confirmationRetry", {
            transaction: shortHex(activeConfirmation.submittedHash)
          })
        );
      } else {
        const message =
          error instanceof Error
            ? (error.message.split("\n", 1)[0] ?? t("create.status.recordingFailed"))
            : t("create.status.recordingFailed");
        setStatus(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="shell workspace">
      <div className="workspace-heading">
        <p className="eyebrow">{t("create.eyebrow", { network: selectedNetwork.name })}</p>
        <h1>{t("create.title")}</h1>
        <p className="lede">{t("create.lede")}</p>
      </div>

      <HandoffStory
        compact
        activeStep={getCreateHandoffStep(
          readyToRecord,
          package_ !== undefined
        )}
      />

      {address === undefined && (
        <section
          className="auth-readiness"
          aria-labelledby="create-auth-heading"
        >
          <div className="auth-readiness-copy">
            <h2 id="create-auth-heading">{t("create.authTitle")}</h2>
            <p>{t("create.authIntro")}</p>
          </div>
          <ol className="auth-checklist">
            <li className="is-needed">
              <span className="auth-check-number">1</span>
              <span>
                <strong>{t("create.walletStep")}</strong>
                <small>{t("create.walletMissing")}</small>
              </span>
              <span className="requirement-badge">
                {t("create.requirementNeeded")}
              </span>
            </li>
            <li>
              <span className="auth-check-number">2</span>
              <span>
                <strong>{t("create.authenticationStep")}</strong>
                <small>{t("create.authenticationMissing")}</small>
              </span>
              <span className="requirement-badge is-next">
                {t("create.requirementNeeded")}
              </span>
            </li>
          </ol>
          <div className="auth-readiness-actions">
            <button
              type="button"
              onClick={onSignInBase}
              disabled={authBusy || !baseSignInAvailable}
            >
              {t("auth.signInBase")}
            </button>
            {browserSignInAvailable && (
              <button
                className="secondary"
                type="button"
                onClick={onSignInBrowser}
                disabled={authBusy}
              >
                {t("auth.browserWallet")}
              </button>
            )}
          </div>
        </section>
      )}

      {walletState === "wrong-network" && (
        <section
          className="authentication-prompt network-prompt"
          aria-labelledby="create-network-heading"
        >
          <span className="authentication-prompt-icon" aria-hidden="true">
            ↔
          </span>
          <div>
            <p className="authentication-prompt-kicker">
              {t("create.networkStep")}
            </p>
            <h2 id="create-network-heading">
              {t("create.networkTitle", { network: selectedNetwork.name })}
            </h2>
            <p>
              {t("create.networkIntro", {
                current: walletChainId ?? t("network.notConnected"),
                network: selectedNetwork.name,
                target: selectedChainId
              })}
            </p>
          </div>
          <div className="authentication-prompt-action">
            <button
              type="button"
              onClick={() => void switchToSelectedNetwork()}
              disabled={busy || authBusy}
            >
              {t("auth.switchTo", { network: selectedNetwork.name })}
            </button>
          </div>
        </section>
      )}

      {address !== undefined && walletState === "authentication-required" && (
        <section
          className="authentication-prompt"
          aria-labelledby="create-authenticate-heading"
        >
          <span className="authentication-prompt-icon" aria-hidden="true">
            2
          </span>
          <div>
            <p className="authentication-prompt-kicker">
              {t("create.authenticationStep")}
            </p>
            <h2 id="create-authenticate-heading">
              {t("create.authenticateTitle")}
            </h2>
            <p>
              {t("create.authenticateIntro", {
                address: shortAddress(address)
              })}
            </p>
          </div>
          <div className="authentication-prompt-action">
            <button type="button" onClick={onAuthenticate} disabled={authBusy}>
              {t("auth.authenticate")}
            </button>
          </div>
        </section>
      )}

      <aside className="privacy-warning">
        <span className="privacy-warning-icon" aria-hidden="true">i</span>
        <div>
          <strong>{t("create.warningTitle")}</strong>
          <p>{t("create.warning")}</p>
        </div>
      </aside>

      {!registryAvailable && (
        <div className="notice">{t("create.mainnetNotice")}</div>
      )}

      <div
        className={
          "operation-status" +
          (busy ? " is-busy" : "") +
          (package_ !== undefined ? " is-success" : "")
        }
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="operation-status-dot" aria-hidden="true" />
        <div>
          <span>{t("create.statusLabel")}</span>
          <p>{status}</p>
        </div>
      </div>

      <div className="flow-grid">
        <section className="panel">
          <span className="step-label">{t("create.step1")}</span>
          <label className="field">
            <span>{t("create.fileLabel")}</span>
            <input
              type="file"
              onChange={(event) => {
                chooseFile(event.target.files?.[0]);
              }}
              disabled={busy}
            />
          </label>
          {file !== undefined && (
            <FilePreview
              key={`${file.name}:${String(file.size)}:${String(file.lastModified)}`}
              file={file}
            />
          )}
          <div className="field-grid">
            <label className="field">
              <span>{t("create.contentType")}</span>
              <select
                value={contentType}
                onChange={(event) => {
                  setContentType(event.target.value as ContentType);
                  setPrepared(undefined);
                }}
                disabled={busy}
              >
                {CONTENT_TYPES.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("create.purpose")}</span>
              <select
                value={purpose}
                onChange={(event) => {
                  setPurpose(event.target.value as Purpose);
                  setPrepared(undefined);
                }}
                disabled={busy}
              >
                {PURPOSES.map((value) => (
                  <option key={value} value={value}>
                    {t(PURPOSE_LABEL_KEYS[value])}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={() => void prepare()}
            disabled={busy || file === undefined}
          >
            {t("create.calculate")}
          </button>
        </section>

        <section className="panel">
          <span className="step-label">{t("create.step2")}</span>
          {prepared === undefined ? (
            <p className="muted">{t("create.reviewEmpty")}</p>
          ) : (
            <dl className="technical-list">
              <div><dt>{t("create.fileSize")}</dt><dd>{prepared.fileSize.toLocaleString(localeTag(locale))} {t("common.bytes")}</dd></div>
              <div><dt>{t("create.commitment")}</dt><dd title={prepared.contentCommitment}>{shortHex(prepared.contentCommitment)}</dd></div>
              <div><dt>{t("create.metadataHash")}</dt><dd title={prepared.metadataHash}>{shortHex(prepared.metadataHash)}</dd></div>
              <div>
                <dt>{t("create.registry")}</dt>
                <dd>
                  {registryAvailable ? shortHex(BASE_SEPOLIA_DEPLOYMENT.registryAddress) : t("common.notDeployed")}
                </dd>
              </div>
            </dl>
          )}
          <p className="muted">{t("create.saltWarning")}</p>
        </section>

        <section
          className="panel"
          aria-busy={confirmationState === "confirming"}
        >
          <span className="step-label">{t("create.step3")}</span>
          {package_ === undefined ? (
            <>
              {!registryAvailable && (
                <p className="muted">{t("create.mainnetUnavailable")}</p>
              )}
              {registryAvailable &&
                pendingConfirmation === undefined &&
                !readyToRecord && (
                  <p className="muted">
                    {t(
                      walletState === "wrong-network"
                        ? "create.networkHint"
                        : "create.signInHint",
                      { network: selectedNetwork.name }
                    )}
                  </p>
                )}
              {pendingConfirmation !== undefined && (
                <>
                  {confirmationState === "confirming" && (
                    <div className="confirmation-progress" role="status">
                      <span
                        className="confirmation-spinner"
                        aria-hidden="true"
                      />
                      <div>
                        <strong>{t("create.confirmingTitle")}</strong>
                        <p>{t("create.confirmingBody")}</p>
                      </div>
                    </div>
                  )}
                  <a
                    href={
                      "https://sepolia.basescan.org/tx/" +
                      pendingConfirmation.submittedHash
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("create.viewTransaction")}
                  </a>
                </>
              )}
              <button
                type="button"
                className={
                  confirmationState === "confirming"
                    ? "confirmation-button is-confirming"
                    : undefined
                }
                onClick={() => void submit()}
                disabled={
                  busy ||
                  (pendingConfirmation === undefined &&
                    (prepared === undefined ||
                      !readyToRecord ||
                      !registryAvailable))
                }
              >
                {confirmationState === "idle"
                  ? t("create.recordOn", { network: selectedNetwork.name })
                  : confirmationState === "confirming"
                    ? (
                        <span className="confirmation-button-content">
                          <span
                            className="confirmation-spinner compact"
                            aria-hidden="true"
                          />
                          {t("create.confirming")}
                        </span>
                      )
                    : t("create.retryConfirmation")}
              </button>
              <p className="muted">
                {registryAvailable
                  ? t("create.feeNotice", { network: selectedNetwork.name })
                  : t("create.noMainnetTransaction")}
              </p>
            </>
          ) : (
            <div className="result-box completed-result">
              <div className="result-heading">
                <span className="result-check" aria-hidden="true">✓</span>
                <strong>{t("create.confirmedTitle")}</strong>
              </div>
              <p className="muted">{t("create.confirmedBody")}</p>
              <button
                type="button"
                onClick={() => {
                  downloadPackage(package_);
                  setStatus(t("create.status.downloadedAgain"));
                }}
              >
                {t("create.downloadPackage")}
              </button>
              <div className="share-panel">
                <h3>{t("create.shareTitle")}</h3>
                <p className="share-warning">{t("create.shareWarning")}</p>
                <span className="share-label">
                  {t("create.handoffUrl")}
                </span>
                <div className="share-url-row">
                  <a
                    href={handoffUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {handoffUrl}
                  </a>
                  <button
                    type="button"
                    className="icon-button copy-share"
                    aria-label={t("create.copyUrl")}
                    title={t("create.copyUrl")}
                    onClick={() =>
                      void copyText(
                        handoffUrl,
                        "create.status.linkCopied",
                        "create.status.linkCopyFailed"
                      )
                    }
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" />
                      <path d="M4.5 13.5h-1A1.5 1.5 0 0 1 2 12V3.5A1.5 1.5 0 0 1 3.5 2H12a1.5 1.5 0 0 1 1.5 1.5v1" />
                    </svg>
                  </button>
                </div>
                <span className="share-label">
                  {t("create.shareMessageLabel")}
                </span>
                <p className="share-message">{shareMessage}</p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void copyText(
                      shareMessage,
                      "create.status.shareMessageCopied",
                      "create.status.shareMessageCopyFailed"
                    )
                  }
                >
                  {t("create.copyShareMessage")}
                </button>
                <div className="handoff-share-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void shareHandoff()}
                  >
                    {t("create.webShare")}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setShowShareQr((value) => !value);
                    }}
                    aria-expanded={showShareQr}
                  >
                    {t(showShareQr ? "create.hideQr" : "create.showQr")}
                  </button>
                </div>
                {showShareQr && (
                  <div className="handoff-qr-panel">
                    <QrCode
                      value={handoffUrl}
                      label={t("create.qrLabel")}
                    />
                    <p>{t("create.qrWarning")}</p>
                  </div>
                )}
              </div>
              <a
                href={"/stamps/" + package_.stampId}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("create.openDetails")}
              </a>
            </div>
          )}
        </section>
      </div>

    </section>
  );
}
