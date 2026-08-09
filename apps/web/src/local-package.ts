import type { Hex } from "viem";
import {
  serializeVerificationPackage,
  type VerificationPackage
} from "./lib/verification-package";

const PACKAGE_SESSION_PREFIX = "basestamp:verification-package:";
const LATEST_CREATED_STAMP_KEY = "basestamp:latest-created-stamp";

export function cacheVerificationPackage(
  package_: VerificationPackage
): void {
  try {
    sessionStorage.setItem(
      PACKAGE_SESSION_PREFIX + package_.stampId,
      serializeVerificationPackage(package_)
    );
  } catch {
    // Download remains available when session storage is blocked or full.
  }
}

export function cacheCreatedVerificationPackage(
  package_: VerificationPackage
): void {
  cacheVerificationPackage(package_);
  try {
    sessionStorage.setItem(LATEST_CREATED_STAMP_KEY, package_.stampId);
  } catch {
    // The explicit download remains the durable handoff artifact.
  }
}

export function readLatestCreatedVerificationPackage(): string | undefined {
  try {
    const stampId = sessionStorage.getItem(LATEST_CREATED_STAMP_KEY);
    return stampId === null
      ? undefined
      : (sessionStorage.getItem(PACKAGE_SESSION_PREFIX + stampId) ?? undefined);
  } catch {
    return undefined;
  }
}

export function readCachedVerificationPackage(
  stampId: Hex
): string | undefined {
  try {
    return (
      sessionStorage.getItem(PACKAGE_SESSION_PREFIX + stampId) ?? undefined
    );
  } catch {
    return undefined;
  }
}
