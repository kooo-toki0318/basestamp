import { useEffect, useState } from "react";
import {
  bytesToHex,
  getAddress,
  isAddressEqual,
  parseEventLogs,
  type Address,
  type Hex
} from "viem";
import { useWriteContract } from "wagmi";
import type { Session } from "../auth-types";
import { FilePreview } from "../components/FilePreview";
import { calculateFileCommitment } from "../lib/commitment-worker";
import {
  bytes32ToBase64Url,
  MAX_FILE_SIZE_BYTES,
  randomBytes32
} from "../lib/crypto";
import { BASE_SEPOLIA_DEPLOYMENT } from "../lib/deployment";
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
  transactionHash: Hex;
};

type CreatePageProperties = {
  address: Address | undefined;
  selectedChainId: SupportedChainId;
  session: Session;
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

export function CreatePage({
  address,
  selectedChainId,
  session
}: CreatePageProperties) {
  const [file, setFile] = useState<File>();
  const [contentType, setContentType] =
    useState<ContentType>("application/pdf");
  const [purpose, setPurpose] = useState<Purpose>("deliverable");
  const [prepared, setPrepared] = useState<PreparedStamp>();
  const [package_, setPackage] = useState<VerificationPackage>();
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation>();
  const [status, setStatus] = useState("Choose a file to begin.");
  const [busy, setBusy] = useState(false);
  const { mutateAsync: writeContractAsync } = useWriteContract();
  const selectedNetwork = getBaseNetwork(selectedChainId);
  const registryAvailable = selectedChainId === 84532;
  useEffect(() => {
    const source = readLatestCreatedVerificationPackage();
    if (source === undefined) return;
    void parseVerificationPackage(source)
      .then((latestPackage) => {
        setPackage(latestPackage);
        setStatus(
          "Latest verification package restored from this browser tab."
        );
      })
      .catch(() => {
        // Invalid or expired tab state is ignored.
      });
  }, []);

  const authenticatedAddress =
    session.authenticated && address !== undefined
      ? isAddressEqual(getAddress(session.walletAddress), address) &&
        session.chainId === selectedChainId
      : false;

  function chooseFile(nextFile: File | undefined): void {
    setPrepared(undefined);
    setPackage(undefined);
    if (nextFile === undefined) {
      setFile(undefined);
      setStatus("Choose a file to begin.");
      return;
    }
    if (nextFile.size > MAX_FILE_SIZE_BYTES) {
      setFile(undefined);
      setStatus("File exceeds the 25 MiB limit.");
      return;
    }
    setFile(nextFile);
    const detectedContentType = CONTENT_TYPES.find(
      (value) => value === nextFile.type
    );
    setContentType(detectedContentType ?? "application/octet-stream");
    setStatus("Ready to calculate locally.");
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
              ? "Reading inside the dedicated worker…"
              : "Calculating SHA-256 inside the dedicated worker…"
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
      setStatus("Public values are ready for review.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Preparation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    if (!registryAvailable && pendingConfirmation === undefined) {
      setStatus("Base Mainnet recording is not available in this release.");
      return;
    }
    if (
      pendingConfirmation === undefined &&
      (prepared === undefined ||
        address === undefined ||
        !authenticatedAddress)
    ) {
      setStatus("Sign in with the connected wallet before recording.");
      return;
    }

    setBusy(true);
    let activeConfirmation = pendingConfirmation;
    try {
      if (activeConfirmation === undefined) {
        if (prepared === undefined || address === undefined) {
          throw new Error("The local record is no longer available.");
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

        setStatus("Review and approve the Registry transaction in your wallet…");
        const transactionHash = await writeContractAsync({
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
          transactionHash
        };
        setPendingConfirmation(activeConfirmation);
      }

      const {
        creator,
        expectedStampId,
        prepared: confirmedPrepared,
        transactionHash
      } = activeConfirmation;

      setStatus("Transaction submitted. Waiting for confirmation…");
      const receipt = await baseSepoliaPublicClient.waitForTransactionReceipt({
        hash: transactionHash,
        confirmations: 1
      });
      if (receipt.status !== "success") {
        setPendingConfirmation(undefined);
        activeConfirmation = undefined;
        throw new Error("The Registry transaction reverted.");
      }

      const events = parseEventLogs({
        abi: registryAbi,
        eventName: "StampCreated",
        logs: receipt.logs,
        strict: true
      });
      const event = events.find(
        (candidate) => candidate.args.stampId === expectedStampId
      );
      if (event === undefined) {
        throw new Error("The confirmation did not contain the expected event.");
      }

      const block = await baseSepoliaPublicClient.getBlock({
        blockNumber: receipt.blockNumber
      });
      if (
        !isAddressEqual(event.args.creator, creator) ||
        event.args.contentCommitment !== confirmedPrepared.contentCommitment ||
        event.args.metadataHash !== confirmedPrepared.metadataHash
      ) {
        throw new Error("The confirmed event does not match local values.");
      }

      const nextPackage: VerificationPackage = {
        schemaVersion: 1,
        type: "BaseStampVerificationPackage",
        app: "BaseStamp",
        network: "base-sepolia",
        chainId: 84532,
        contractAddress: BASE_SEPOLIA_DEPLOYMENT.registryAddress,
        stampId: expectedStampId,
        transactionHash,
        blockNumber: Number(receipt.blockNumber),
        blockHash: block.hash,
        blockTimestamp: formatUnixSeconds(block.timestamp),
        creator: getAddress(creator),
        createdAt: formatUnixSeconds(event.args.createdAt),
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
      setStatus("Recorded on Base Sepolia. The verification JSON was downloaded.");
    } catch (error) {
      if (activeConfirmation !== undefined) {
        setStatus(
          `Transaction ${shortHex(activeConfirmation.transactionHash)} was submitted. ` +
            "Confirmation is temporarily unavailable; retry confirmation without sending another transaction."
        );
      } else {
        const message =
          error instanceof Error
            ? (error.message.split("\n", 1)[0] ?? "Recording failed.")
            : "Recording failed.";
        setStatus(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="shell workspace">
      <div className="workspace-heading">
        <p className="eyebrow">Create · {selectedNetwork.name}</p>
        <h1>Record a private file commitment.</h1>
        <p className="lede">
          The file is read only in a dedicated browser worker. File bytes and
          file names are never sent to BaseStamp servers.
        </p>
      </div>

      <div className="notice warning">
        Recorded values are public and cannot be deleted. Do not enter personal
        information or confidential text. This is not notarization or a guarantee
        of legal effect.
      </div>

      {!registryAvailable && (
        <div className="notice">
          Base Mainnet can be selected and connected, but its Registry is not
          deployed in this release. File preparation remains local and no
          Mainnet transaction can be submitted.
        </div>
      )}

      <div className="flow-grid">
        <section className="panel">
          <span className="step-label">1 · Local preparation</span>
          <label className="field">
            <span>File, maximum 25 MiB</span>
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
              <span>Content type</span>
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
              <span>Purpose</span>
              <select
                value={purpose}
                onChange={(event) => {
                  setPurpose(event.target.value as Purpose);
                  setPrepared(undefined);
                }}
                disabled={busy}
              >
                {PURPOSES.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={() => void prepare()}
            disabled={busy || file === undefined}
          >
            Calculate locally
          </button>
        </section>

        <section className="panel">
          <span className="step-label">2 · Review public values</span>
          {prepared === undefined ? (
            <p className="muted">Calculate the commitment to review it here.</p>
          ) : (
            <dl className="technical-list">
              <div><dt>File size</dt><dd>{prepared.fileSize.toLocaleString()} bytes</dd></div>
              <div><dt>Commitment</dt><dd title={prepared.contentCommitment}>{shortHex(prepared.contentCommitment)}</dd></div>
              <div><dt>Metadata hash</dt><dd title={prepared.metadataHash}>{shortHex(prepared.metadataHash)}</dd></div>
              <div>
                <dt>Registry</dt>
                <dd>
                  {registryAvailable ? shortHex(BASE_SEPOLIA_DEPLOYMENT.registryAddress) : "Not deployed"}
                </dd>
              </div>
            </dl>
          )}
          <p className="muted">
            The content salt stays in the verification package. Losing it makes
            local file comparison impossible.
          </p>
        </section>

        <section className="panel">
          <span className="step-label">3 · Record and save</span>
          {!registryAvailable && (
            <p className="muted">Recording is not available on Base Mainnet yet.</p>
          )}
          {registryAvailable &&
            pendingConfirmation === undefined &&
            !authenticatedAddress && (
            <p className="muted">
              Sign in from the header with the same connected wallet before
              submitting.
            </p>
          )}
          {pendingConfirmation !== undefined && (
            <a
              href={`https://sepolia.basescan.org/tx/${pendingConfirmation.transactionHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View submitted transaction
            </a>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={
              busy ||
              (pendingConfirmation === undefined &&
                (prepared === undefined ||
                  !authenticatedAddress ||
                  !registryAvailable))
            }
          >
            {pendingConfirmation === undefined ? `Record on ${selectedNetwork.name}` : "Retry confirmation"}
          </button>
          <p className="muted">
            {registryAvailable
              ? `Sponsorship is disabled. Your wallet pays the ${selectedNetwork.name} network fee.`
              : "No Mainnet transaction will be requested."}
          </p>
          {package_ !== undefined && (
            <div className="result-box">
              <strong>Record confirmed — save the JSON now</strong>
              <p className="muted">
                Keep the downloaded JSON with the original file. Send both to
                the recipient; they can verify without connecting a wallet.
              </p>
              <button
                type="button"
                onClick={() => {
                  downloadPackage(package_);
                  setStatus("Verification package downloaded again.");
                }}
              >
                Download verification package
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(package_.verificationUrl)
                    .then(() => {
                      setStatus("Verification link copied.");
                    })
                    .catch(() => {
                      setStatus("Could not copy the verification link.");
                    });
                }}
              >
                Copy verification link
              </button>
              <a
                href={"/stamps/" + package_.stampId}
                target="_blank"
                rel="noreferrer"
              >
                Open stamp details in a new tab
              </a>
            </div>
          )}
        </section>
      </div>

      <p className="status prominent" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
