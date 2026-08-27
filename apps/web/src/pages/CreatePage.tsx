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
import { CreateAccessPanel } from "../components/create/CreateAccessPanel";
import { CreatePreparationPanel } from "../components/create/CreatePreparationPanel";
import { CreateStatusBar } from "../components/create/CreateStatusBar";
import { CreateSubmitPanel } from "../components/create/CreateSubmitPanel";
import { CreateSuccessPanel } from "../components/create/CreateSuccessPanel";
import { CreateTechnicalDetails } from "../components/create/CreateTechnicalDetails";
import {
  getCreateConfirmationState,
  getCreateFundingMode,
  getSponsorCapabilityState,
  getCreateWalletState
} from "../create-wallet-state";
import { useI18n, type MessageKey } from "../i18n-context";
import { calculateFileCommitment } from "../lib/commitment-worker";
import {
  bytes32ToBase64Url,
  MAX_FILE_SIZE_BYTES,
  randomBytes32
} from "../lib/crypto";
import { getDeployment } from "../lib/deployment";
import { createHandoffUrl } from "../lib/handoff";
import {
  cacheCreatedVerificationPackage,
  readLatestCreatedVerificationPackage
} from "../local-package";
import {
  CONTENT_TYPES,
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

function shortHex(value: string): string {
  return value.slice(0, 10) + "…" + value.slice(-8);
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
  authBusy,
  baseSignInAvailable,
  browserSignInAvailable,
  onSignInBase,
  onSignInBrowser,
  onAuthenticate,
  onEnsureNetwork
}: CreatePageProperties) {
  const { t } = useI18n();
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

  const connectedAddressReady =
    address !== undefined && walletChainId === selectedChainId;
  const walletState = getCreateWalletState(
    address !== undefined,
    walletChainId,
    selectedChainId,
    connectedAddressReady
  );
  const readyToRecord = walletState === "ready";
  const sponsorshipConfigured =
    sponsorshipEnabled &&
    registryAvailable &&
    (connectorId === "baseAccount" || connectorId === "injected") &&
    turnstileSiteKey !== undefined &&
    builderAttribution !== undefined;
  const {
    data: walletCapabilities,
    isError: walletCapabilitiesFailed,
    isSuccess: walletCapabilitiesResolved
  } = useCapabilities({
    chainId: selectedChainId,
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

  const handoffUrl =
    package_ === undefined
      ? ""
      : createHandoffUrl(
          window.location.origin,
          package_.stampId,
          package_.commitment.contentSalt,
          package_.chainId
        );
  const shareMessage =
    package_ === undefined
      ? ""
      : t("create.shareMessage", { url: handoffUrl });
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
      setStatus(
        error instanceof Error
          ? error.message
          : t("create.status.preparationFailed")
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    if (!registryAvailable && pendingConfirmation === undefined) {
      setStatus(
        t("create.status.mainnetUnavailable", {
          network: selectedNetwork.name
        })
      );
      return;
    }
    if (
      pendingConfirmation === undefined &&
      (prepared === undefined ||
        address === undefined ||
        !connectedAddressReady)
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
                chainId: deployment.chainId,
                idempotencyKey: sponsorIdempotencyKey,
                turnstileToken,
                walletAddress: address
              },
              t
            );
            setSponsorGrant(activeGrant);
          }

          setStatus(t("create.status.approveSponsoredTransaction"));
          const submittedCalls = await sendCallsAsync(createSponsoredStampCall({
            account: address,
            builderDataSuffix: builderAttribution.dataSuffix,
            chainId: deployment.chainId,
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
            args: [
              prepared.contentCommitment,
              prepared.metadataHash,
              stampNonceHex
            ]
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
      const confirmationDeployment = getDeployment(confirmationChainId);

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
      setStatus(
        t("create.status.recorded", {
          network: getBaseNetwork(confirmationChainId).name
        })
      );
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
            ? (error.message.split("\n", 1)[0] ??
              t("create.status.recordingFailed"))
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
        <p className="eyebrow">
          {t("create.eyebrow", { network: selectedNetwork.name })}
        </p>
        <h1>{t("create.title")}</h1>
        <p className="lede">{t("create.lede")}</p>
      </div>

      <aside className="privacy-warning">
        <span className="privacy-warning-icon" aria-hidden="true">i</span>
        <div>
          <strong>{t("create.warningTitle")}</strong>
          <p>{t("create.warning")}</p>
        </div>
      </aside>

      {!registryAvailable && (
        <div className="notice">
          {t("create.mainnetNotice", { network: selectedNetwork.name })}
        </div>
      )}

      <CreateStatusBar
        busy={busy}
        success={package_ !== undefined}
        status={status}
      />

      {package_ === undefined ? (
        <>
          <div className="handoff-grid">
            <CreatePreparationPanel
              file={file}
              contentType={contentType}
              purpose={purpose}
              busy={busy}
              onChooseFile={chooseFile}
              onContentTypeChange={(value) => {
                setContentType(value);
                setPrepared(undefined);
              }}
              onPurposeChange={(value) => {
                setPurpose(value);
                setPrepared(undefined);
              }}
              onPrepare={() => void prepare()}
            />
            <CreateTechnicalDetails
              prepared={prepared}
              registryAvailable={registryAvailable}
              registryAddress={deployment.registryAddress}
            />
          </div>

          {prepared !== undefined && (
            <>
              <CreateAccessPanel
                address={address}
                walletState={walletState}
                walletChainId={walletChainId}
                selectedChainId={selectedChainId}
                selectedNetworkName={selectedNetwork.name}
                authBusy={authBusy}
                busy={busy}
                baseSignInAvailable={baseSignInAvailable}
                browserSignInAvailable={browserSignInAvailable}
                onSignInBase={onSignInBase}
                onSignInBrowser={onSignInBrowser}
                onAuthenticate={onAuthenticate}
                onSwitchNetwork={() => void switchToSelectedNetwork()}
              />

              <CreateSubmitPanel
                busy={busy}
                confirmationState={confirmationState}
                fundingMode={fundingMode}
                pendingConfirmation={pendingConfirmation}
                preparedAvailable
                readyToRecord={readyToRecord}
                registryAvailable={registryAvailable}
                selectedNetworkName={selectedNetwork.name}
                sponsorshipAvailable={sponsorshipAvailable}
                sponsorshipCapabilityChecking={sponsorshipCapabilityChecking}
                sponsorshipCapabilityUnavailable={sponsorshipCapabilityUnavailable}
                sponsorshipConfigured={sponsorshipConfigured}
                sponsorFailure={sponsorFailure}
                sponsorGrantReady={sponsorGrant !== undefined}
                turnstileSiteKey={turnstileSiteKey}
                turnstileResetKey={turnstileResetKey}
                turnstileTokenReady={turnstileToken !== undefined}
                walletFeeChosen={walletFeeChosen}
                walletState={walletState}
                onChooseWalletFee={() => {
                  setWalletFeeChosen(true);
                  setStatus(t("create.status.walletFeeSelected"));
                }}
                onRetrySponsor={() => {
                  setWalletFeeChosen(false);
                  setSponsorFailure(undefined);
                  setStatus(t("create.status.sponsorSelected"));
                }}
                onSubmit={() => void submit()}
                onTurnstileError={handleTurnstileError}
                onTurnstileTokenChange={handleTurnstileTokenChange}
              />
            </>
          )}
        </>
      ) : (
        <CreateSuccessPanel
          package_={package_}
          handoffUrl={handoffUrl}
          shareMessage={shareMessage}
          webShareAvailable={webShareAvailable}
          showShareQr={showShareQr}
          onDownload={() => {
            downloadPackage(package_);
            setStatus(t("create.status.downloadedAgain"));
          }}
          onCopyUrl={() =>
            void copyText(
              handoffUrl,
              "create.status.linkCopied",
              "create.status.linkCopyFailed"
            )
          }
          onCopyShareMessage={() =>
            void copyText(
              shareMessage,
              "create.status.shareMessageCopied",
              "create.status.shareMessageCopyFailed"
            )
          }
          onShare={() => void shareHandoff()}
          onToggleQr={() => {
            setShowShareQr((value) => !value);
          }}
        />
      )}
    </section>
  );
}
