import { useCallback, useEffect, useState } from "react";
import {
  bytesToHex,
  concatHex,
  encodeFunctionData,
  getAddress,
  isAddressEqual,
  type Address,
  type Hex
} from "viem";
import { useCapabilities, useSendCalls, useSendTransaction } from "wagmi";
import type { Session } from "../auth-types";
import { useI18n, type MessageKey } from "../i18n-context";
import { localeTag } from "../locale";
import { FilePreview } from "../components/FilePreview";
import { HandoffStory } from "../components/HandoffStory";
import { QrCode } from "../components/QrCode";
import { TurnstileWidget } from "../components/TurnstileWidget";
import {
  getCreateConfirmationState,
  getCreateFundingMode,
  getSponsorCapabilityState,
  getCreateWalletState
} from "../create-wallet-state";
import { getCreateHandoffStep } from "../handoff-role";
import { calculateFileCommitment } from "../lib/commitment-worker";
import {
  bytes32ToBase64Url,
  MAX_FILE_SIZE_BYTES,
  randomBytes32
} from "../lib/crypto";
import {
  BASE_SEPOLIA_DEPLOYMENT,
  getDeployment
} from "../lib/deployment";
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
  isMainnetWriteFlagEnabled,
  isRegistryWriteAvailable,
  type SupportedChainId
} from "../lib/networks";
import { getDeploymentPublicClient } from "../lib/onchain";
import { deriveStampId, registryAbi } from "../lib/registry";
import { createStampPath } from "../lib/routes";
import {
  createSponsorIdempotencyKey,
  type SponsorGrantResponse
} from "../lib/sponsor";
import {
  readBuilderAttribution,
  readSponsorshipEnabled,
  readTurnstileSiteKey,
  requestSponsorGrant
} from "../sponsor-client";
import { createSponsoredStampCall } from "../sponsored-stamp";
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
  chainId: SupportedChainId;
  creator: Address;
  expectedStampId: Hex;
  prepared: PreparedStamp;
  searchFromBlock: bigint;
  submittedHash?: Hex;
  submittedReference: string;
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
  connectorId: string | undefined;
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
  const deployment = getDeployment(confirmation.chainId);
  const publicClient = getDeploymentPublicClient(confirmation.chainId);
  let lastError: unknown;

  while (Date.now() < deadline) {
    let events;
    try {
      events = await publicClient.getContractEvents({
        address: deployment.registryAddress,
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
      const block = await publicClient.getBlock({
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
  connectorId,
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
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [sponsorGrant, setSponsorGrant] = useState<SponsorGrantResponse>();
  const [sponsorFailure, setSponsorFailure] = useState<string>();
  const [walletFeeChosen, setWalletFeeChosen] = useState(false);
  const [sponsorIdempotencyKey, setSponsorIdempotencyKey] = useState(
    createSponsorIdempotencyKey
  );
  const { mutateAsync: sendTransactionAsync } = useSendTransaction();
  const { mutateAsync: sendCallsAsync } = useSendCalls();
  const selectedNetwork = getBaseNetwork(selectedChainId);
  const deployment = getDeployment(selectedChainId);
  const deploymentPublicClient = getDeploymentPublicClient(selectedChainId);
  const registryAvailable = isRegistryWriteAvailable(
    selectedChainId,
    selectedNetwork.registryAvailable,
    isMainnetWriteFlagEnabled(import.meta.env.VITE_MAINNET_WRITES_ENABLED)
  );
  const turnstileSiteKey = readTurnstileSiteKey();
  const sponsorshipEnabled = readSponsorshipEnabled();
  const builderAttribution = readBuilderAttribution();
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
  const sponsorshipConfigured =
    selectedChainId === BASE_SEPOLIA_DEPLOYMENT.chainId &&
    sponsorshipEnabled &&
    registryAvailable &&
    connectorId === "baseAccount" &&
    turnstileSiteKey !== undefined &&
    builderAttribution !== undefined;
  const {
    data: walletCapabilities,
    isError: walletCapabilitiesFailed,
    isSuccess: walletCapabilitiesResolved
  } = useCapabilities({
    chainId: BASE_SEPOLIA_DEPLOYMENT.chainId,
    query: {
      enabled: sponsorshipConfigured && address !== undefined
    }
  });
  const sponsorCapabilityState = getSponsorCapabilityState(
    sponsorshipConfigured,
    walletCapabilitiesResolved,
    walletCapabilities?.paymasterService?.supported === true,
    walletCapabilitiesFailed
  );
  const sponsorshipAvailable = sponsorCapabilityState === "supported";
  const sponsorshipCapabilityChecking =
    sponsorCapabilityState === "checking";
  const sponsorshipCapabilityUnavailable =
    sponsorCapabilityState === "unsupported";
  const fundingMode = getCreateFundingMode(
    sponsorshipAvailable,
    walletFeeChosen
  );
  const confirmationState = getCreateConfirmationState(
    pendingConfirmation !== undefined,
    busy
  );

  const handoffAvailable =
    package_?.chainId === BASE_SEPOLIA_DEPLOYMENT.chainId;
  const handoffUrl =
    package_ === undefined || !handoffAvailable
      ? ""
      : createHandoffUrl(
          window.location.origin,
          package_.stampId,
          package_.commitment.contentSalt
        );
  const shareMessage =
    handoffAvailable
      ? t("create.shareMessage", { url: handoffUrl })
      : "";
  const webShareAvailable =
    typeof Reflect.get(navigator, "share") === "function";

  const handleTurnstileTokenChange = useCallback(
    (token: string | undefined) => {
      setTurnstileToken(token);
      if (token !== undefined) setSponsorFailure(undefined);
    },
    []
  );
  const handleTurnstileError = useCallback(() => {
    const message = t("create.status.turnstileFailed");
    setSponsorFailure(message);
    setStatus(message);
  }, [t]);

  function resetSponsorAttempt(): void {
    setTurnstileToken(undefined);
    setSponsorGrant(undefined);
    setSponsorFailure(undefined);
    setWalletFeeChosen(false);
    setSponsorIdempotencyKey(createSponsorIdempotencyKey());
    setTurnstileResetKey((value) => value + 1);
  }

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
    resetSponsorAttempt();
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
    if (
      pendingConfirmation === undefined &&
      sponsorshipConfigured &&
      !sponsorshipAvailable &&
      !walletFeeChosen
    ) {
      setStatus(
        t(
          sponsorshipCapabilityChecking
            ? "create.status.sponsorCapabilityChecking"
            : "create.status.sponsorCapabilityUnavailable"
        )
      );
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
          chainId: deployment.chainId,
          registryAddress: deployment.registryAddress,
          creator: address,
          contentCommitment: prepared.contentCommitment,
          metadataHash: prepared.metadataHash,
          stampNonce: stampNonceHex
        });
        const searchFromBlock =
          await deploymentPublicClient.getBlockNumber();

        let submittedHash: Hex | undefined;
        let submittedReference: string;
        if (fundingMode === "sponsored") {
          if (builderAttribution === undefined) {
            throw new Error(t("create.status.sponsorFailed", {
              message: t("api.sponsorNotConfigured")
            }));
          }
          let activeGrant = sponsorGrant;
          if (activeGrant === undefined) {
            if (turnstileToken === undefined) {
              throw new Error(t("create.status.turnstileRequired"));
            }
            setStatus(t("create.status.requestingSponsor"));
            activeGrant = await requestSponsorGrant(
              {
                chainId: BASE_SEPOLIA_DEPLOYMENT.chainId,
                idempotencyKey: sponsorIdempotencyKey,
                turnstileToken
              },
              t
            );
            setSponsorGrant(activeGrant);
          }

          setStatus(t("create.status.approveSponsoredTransaction"));
          const submittedCalls = await sendCallsAsync(createSponsoredStampCall({
            account: address,
            builderDataSuffix: builderAttribution.dataSuffix,
            contentCommitment: prepared.contentCommitment,
            grant: activeGrant,
            metadataHash: prepared.metadataHash,
            origin: window.location.origin,
            stampNonce: stampNonceHex
          }));
          submittedReference = submittedCalls.id;
        } else {
          setStatus(t("create.status.approveTransaction"));
          const registryCall = encodeFunctionData({
            abi: registryAbi,
            functionName: "createStamp",
            args: [prepared.contentCommitment, prepared.metadataHash, stampNonceHex]
          });
          submittedHash = await sendTransactionAsync({
            account: address,
            chainId: deployment.chainId,
            data:
              builderAttribution === undefined
                ? registryCall
                : concatHex([registryCall, builderAttribution.dataSuffix]),
            to: deployment.registryAddress
          });
          submittedReference = submittedHash;
        }

        activeConfirmation = {
          chainId: deployment.chainId,
          creator: address,
          expectedStampId,
          prepared,
          searchFromBlock,
          submittedHash,
          submittedReference
        };
        setPendingConfirmation(activeConfirmation);
      }

      const {
        chainId: confirmationChainId,
        creator,
        expectedStampId,
        prepared: confirmedPrepared
      } = activeConfirmation;
      const confirmationDeployment =
        getDeployment(confirmationChainId);

      setStatus(t("create.status.waiting"));
      const confirmedRecord = await waitForAutomaticConfirmation(
        activeConfirmation,
        t("create.status.eventMismatch")
      );

      const nextPackage: VerificationPackage = {
        schemaVersion: 1,
        type: "BaseStampVerificationPackage",
        app: "BaseStamp",
        network: confirmationDeployment.network,
        chainId: confirmationDeployment.chainId,
        contractAddress: confirmationDeployment.registryAddress,
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
          window.location.origin +
          createStampPath(confirmationChainId, expectedStampId)
      };
      setPackage(nextPackage);
      cacheCreatedVerificationPackage(nextPackage);
      downloadPackage(nextPackage);
      setPendingConfirmation(undefined);
      resetSponsorAttempt();
      setStatus(t("create.status.recorded"));
    } catch (error) {
      if (activeConfirmation !== undefined) {
        setStatus(
          t("create.status.confirmationRetry", {
            transaction: shortHex(activeConfirmation.submittedReference)
          })
        );
      } else {
        const message =
          error instanceof Error
            ? (error.message.split("\n", 1)[0] ?? t("create.status.recordingFailed"))
            : t("create.status.recordingFailed");
        const displayedMessage =
          fundingMode === "sponsored"
            ? t("create.status.sponsorFailed", { message })
            : message;
        if (fundingMode === "sponsored") {
          setSponsorFailure(displayedMessage);
        }
        setStatus(displayedMessage);
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
                  {registryAvailable
                    ? shortHex(deployment.registryAddress)
                    : t("common.notDeployed")}
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
                  {pendingConfirmation.submittedHash !== undefined && (
                    <a
                      href={
                        getDeployment(pendingConfirmation.chainId).explorerUrl +
                        "/tx/" +
                        pendingConfirmation.submittedHash
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t("create.viewTransaction")}
                    </a>
                  )}
                </>
              )}
              {sponsorshipConfigured &&
                pendingConfirmation === undefined &&
                prepared !== undefined &&
                readyToRecord && (
                  <div className="sponsor-choice">
                    {sponsorshipCapabilityChecking ? (
                      <>
                        <div>
                          <strong>
                            {t("create.sponsorCapabilityCheckingTitle")}
                          </strong>
                          <p>{t("create.sponsorCapabilityCheckingBody")}</p>
                        </div>
                        <div
                          className="sponsor-capability-progress"
                          role="status"
                        >
                          <span
                            className="confirmation-spinner compact"
                            aria-hidden="true"
                          />
                          <span>
                            {t("create.sponsorCapabilityCheckingStatus")}
                          </span>
                        </div>
                        {walletFeeChosen ? (
                          <p className="sponsor-wallet-paid">
                            {t("create.walletFeeSelected")}
                          </p>
                        ) : (
                          <button
                            type="button"
                            className="secondary sponsor-choice-action"
                            onClick={() => {
                              setWalletFeeChosen(true);
                              setStatus(t("create.status.walletFeeSelected"));
                            }}
                            disabled={busy}
                          >
                            {t("create.useWalletFee")}
                          </button>
                        )}
                      </>
                    ) : sponsorshipCapabilityUnavailable ? (
                      <>
                        <div>
                          <strong>
                            {t("create.sponsorCapabilityUnavailableTitle")}
                          </strong>
                          <p>{t("create.sponsorCapabilityUnavailableBody")}</p>
                        </div>
                        {walletFeeChosen ? (
                          <p className="sponsor-wallet-paid">
                            {t("create.walletFeeSelected")}
                          </p>
                        ) : (
                          <button
                            type="button"
                            className="secondary sponsor-choice-action"
                            onClick={() => {
                              setWalletFeeChosen(true);
                              setStatus(t("create.status.walletFeeSelected"));
                            }}
                            disabled={busy}
                          >
                            {t("create.useWalletFee")}
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <div>
                          <strong>{t("create.sponsorTitle")}</strong>
                          <p>{t("create.sponsorIntro")}</p>
                        </div>
                        {fundingMode === "sponsored" ? (
                          <>
                            {sponsorGrant === undefined ? (
                              <TurnstileWidget
                                accessibleLabel={t("create.sponsorCheckLabel")}
                                onError={handleTurnstileError}
                                onTokenChange={handleTurnstileTokenChange}
                                resetKey={turnstileResetKey}
                                siteKey={turnstileSiteKey}
                              />
                            ) : (
                              <p className="sponsor-ready" role="status">
                                {t("create.sponsorReady")}
                              </p>
                            )}
                            {sponsorFailure !== undefined && (
                              <p className="sponsor-error" role="alert">
                                {sponsorFailure}
                              </p>
                            )}
                            <button
                              type="button"
                              className="secondary sponsor-choice-action"
                              onClick={() => {
                                setWalletFeeChosen(true);
                                setStatus(t("create.status.walletFeeSelected"));
                              }}
                              disabled={busy}
                            >
                              {t("create.useWalletFee")}
                            </button>
                          </>
                        ) : (
                          <>
                            <p className="sponsor-wallet-paid">
                              {t("create.walletFeeSelected")}
                            </p>
                            <button
                              type="button"
                              className="secondary sponsor-choice-action"
                              onClick={() => {
                                setWalletFeeChosen(false);
                                setSponsorFailure(undefined);
                                setStatus(t("create.status.sponsorSelected"));
                              }}
                              disabled={busy}
                            >
                              {t("create.trySponsor")}
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
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
                      !registryAvailable ||
                      (sponsorshipConfigured &&
                        !sponsorshipAvailable &&
                        !walletFeeChosen) ||
                      (fundingMode === "sponsored" &&
                        sponsorGrant === undefined &&
                        turnstileToken === undefined)))
                }
              >
                {confirmationState === "idle"
                  ? sponsorshipCapabilityChecking && !walletFeeChosen
                    ? t("create.checkingSponsor")
                    : t(
                        fundingMode === "sponsored"
                          ? "create.recordSponsored"
                          : "create.recordOn",
                        { network: selectedNetwork.name }
                      )
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
                  ? sponsorshipCapabilityChecking && !walletFeeChosen
                    ? t("create.sponsorCapabilityCheckingBody")
                    : t(
                        fundingMode === "sponsored"
                          ? "create.sponsorFeeNotice"
                          : "create.feeNotice",
                        { network: selectedNetwork.name }
                      )
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
              <div className="result-transaction">
                <span>{t("create.transactionHash")}</span>
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
              <button
                type="button"
                className="secondary result-download-action"
                onClick={() => {
                  downloadPackage(package_);
                  setStatus(t("create.status.downloadedAgain"));
                }}
              >
                {t("create.downloadPackage")}
              </button>
              <div
                className="share-panel"
                hidden={!handoffAvailable}
              >
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
                <div className="share-action-group">
                  <button
                    type="button"
                    className="share-primary-action"
                    onClick={() =>
                      void copyText(
                        shareMessage,
                        "create.status.shareMessageCopied",
                        "create.status.shareMessageCopyFailed"
                      )
                    }
                  >
                    <span className="share-action-icon" aria-hidden="true">
                      <svg viewBox="0 0 20 20">
                        <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" />
                        <path d="M4.5 13.5h-1A1.5 1.5 0 0 1 2 12V3.5A1.5 1.5 0 0 1 3.5 2H12a1.5 1.5 0 0 1 1.5 1.5v1" />
                      </svg>
                    </span>
                    <span className="share-action-copy">
                      <strong>{t("create.copyShareMessage")}</strong>
                      <small>{t("create.copyShareMessageHint")}</small>
                    </span>
                  </button>
                  <div className="share-secondary-group">
                    <span>{t("create.moreShareOptions")}</span>
                    <div className="share-secondary-actions">
                      {webShareAvailable && (
                        <button
                          type="button"
                          onClick={() => void shareHandoff()}
                        >
                          <svg viewBox="0 0 20 20" aria-hidden="true">
                            <circle cx="15" cy="4" r="2" />
                            <circle cx="5" cy="10" r="2" />
                            <circle cx="15" cy="16" r="2" />
                            <path d="m6.8 9 6.4-3.8M6.8 11l6.4 3.8" />
                          </svg>
                          {t("create.webShare")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setShowShareQr((value) => !value);
                        }}
                        aria-expanded={showShareQr}
                        aria-controls="create-handoff-qr"
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <rect x="2.5" y="2.5" width="5" height="5" rx="0.5" />
                          <rect x="12.5" y="2.5" width="5" height="5" rx="0.5" />
                          <rect x="2.5" y="12.5" width="5" height="5" rx="0.5" />
                          <path d="M12.5 12.5h2v2h-2zM15.5 15.5h2v2h-2zM15.5 11.5h2M11.5 15.5v2" />
                        </svg>
                        {t(showShareQr ? "create.hideQr" : "create.showQr")}
                      </button>
                    </div>
                  </div>
                </div>
                {showShareQr && (
                  <div className="handoff-qr-panel" id="create-handoff-qr">
                    <QrCode
                      value={handoffUrl}
                      label={t("create.qrLabel")}
                    />
                    <p>{t("create.qrWarning")}</p>
                  </div>
                )}
              </div>
              <a
                href={package_.verificationUrl}
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