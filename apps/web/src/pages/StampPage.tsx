import { useEffect, useState } from "react";
import { hexToBytes, type Hex } from "viem";
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
  readCachedVerificationPackage
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
  const [stamp, setStamp] = useState<RegistryStamp>();
  const [package_, setPackage] = useState<VerificationPackage>();
  const [file, setFile] = useState<File>();
  const [status, setStatus] = useState("Loading Registry record…");
  const [match, setMatch] = useState<boolean>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void readRegistryStamp(stampId)
      .then(async (nextStamp) => {
        if (!active) return;
        setStamp(nextStamp);
        setStatus("Registry record loaded.");
        const cachedSource = readCachedVerificationPackage(stampId);
        if (cachedSource === undefined) return;
        setBusy(true);
        try {
          const parsed = await parseVerificationPackage(cachedSource);
          const verifiedStamp = await verifyPackageOnchain(parsed);
          setStamp(verifiedStamp);
          setPackage(parsed);
          setStatus(
            "Saved verification package restored. Choose the original file."
          );
        } catch {
          setStatus("The saved verification package could not be restored.");
        } finally {
          setBusy(false);
        }
      })
      .catch(() => {
        if (!active) return;
        setStatus("This stamp was not found in the approved Registry.");
      });
    return () => {
      active = false;
    };
  }, [stampId]);

  async function loadPackage(packageFile: File | undefined): Promise<void> {
    setPackage(undefined);
    setFile(undefined);
    setMatch(undefined);
    if (packageFile === undefined) return;
    if (packageFile.size > MAX_PACKAGE_BYTES) {
      setStatus("Verification package exceeds the 64 KiB limit.");
      return;
    }

    setBusy(true);
    try {
      const parsed = await parseVerificationPackage(await packageFile.text());
      if (parsed.stampId !== stampId) {
        throw new Error("Package stamp ID does not match this page.");
      }
      const verifiedStamp = await verifyPackageOnchain(parsed);
      setStamp(verifiedStamp);
      setPackage(parsed);
      cacheVerificationPackage(parsed);
      setStatus(
        "Package, Registry, receipt, block, and event all match. Choose the original file."
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Package verification failed.");
    } finally {
      setBusy(false);
    }
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
        setStatus("File size does not match the verification package.");
        return;
      }
      const result = await calculateFileCommitment(
        file,
        base64UrlToBytes32(package_.commitment.contentSalt),
        (workerStatus) => {
          setStatus(
            workerStatus === "reading"
              ? "Reading inside the dedicated worker…"
              : "Recalculating the commitment locally…"
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
          ? "The selected file and verification key match the Base record."
          : "The selected file or verification key does not match the Base record."
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Local verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="shell workspace">
      <div className="workspace-heading">
        <p className="eyebrow">Verify · Base Sepolia</p>
        <h1>Check a BaseStamp record.</h1>
        <p className="lede">
          Public Registry data is read from the fixed Base Sepolia deployment.
          Package URLs and RPC values are never used as request destinations.
        </p>
      </div>

      <div className="flow-grid">
        <section className="panel">
          <span className="step-label">1 · Registry record</span>
          <dl className="technical-list">
            <div><dt>Stamp ID</dt><dd title={stampId}>{shortHex(stampId)}</dd></div>
            <div><dt>Registry</dt><dd title={BASE_SEPOLIA_DEPLOYMENT.registryAddress}>{shortHex(BASE_SEPOLIA_DEPLOYMENT.registryAddress)}</dd></div>
            {stamp !== undefined && (
              <>
                <div><dt>Creator</dt><dd title={stamp.creator}>{shortHex(stamp.creator)}</dd></div>
                <div><dt>Created</dt><dd>{formatUnixSeconds(stamp.createdAt)}</dd></div>
                <div><dt>Commitment</dt><dd title={stamp.contentCommitment}>{shortHex(stamp.contentCommitment)}</dd></div>
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
            Open Registry in explorer
          </a>
        </section>

        <section className="panel">
          <span className="step-label">2 · Verification package</span>
          <label className="field">
            <span>BaseStamp JSON, maximum 64 KiB</span>
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => void loadPackage(event.target.files?.[0])}
              disabled={busy || stamp === undefined}
            />
          </label>
          <p className="muted">
            The package is untrusted input. Unknown fields, duplicate keys,
            unknown versions, and substituted chain or contract values are rejected.
          </p>
        </section>

        <section className="panel">
          <span className="step-label">3 · Local file comparison</span>
          <label className="field">
            <span>Original file, maximum 25 MiB</span>
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
                    setStatus("File exceeds the 25 MiB limit.");
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
            Verify locally
          </button>
          {match !== undefined && (
            <div className={match ? "match success" : "match failure"}>
              {match ? "Match" : "No match"}
            </div>
          )}
        </section>
      </div>

      <div className="notice">
        The file and content salt remain in your browser. A matching result means
        the selected bytes and key reproduce the recorded commitment; it does not
        prove identity, authority, acceptance, or legal effect.
      </div>
      <p className="status prominent" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
