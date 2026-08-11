import type { Hex } from "viem";
import { parseHandoffFragment } from "./lib/handoff";

type CapturedHandoffFragment =
  | { status: "missing"; stampId: Hex }
  | { status: "invalid"; stampId: Hex }
  | { status: "valid"; stampId: Hex; contentSalt: Uint8Array };

let capturedFragment: CapturedHandoffFragment | undefined;

export function captureHandoffFragment(): void {
  const match = /^\/handoff\/(0x[0-9a-fA-F]{64})\/?$/u.exec(
    window.location.pathname
  );
  const rawStampId = match?.[1];
  if (rawStampId === undefined) return;
  const stampId = rawStampId.toLowerCase() as Hex;

  try {
    capturedFragment = {
      status: "valid",
      stampId,
      contentSalt: parseHandoffFragment(window.location.hash)
    };
  } catch {
    capturedFragment = {
      status: window.location.hash === "" ? "missing" : "invalid",
      stampId
    };
  }

  if (window.location.hash !== "") {
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search
    );
  }
}

export function readCapturedHandoffFragment(
  stampId: Hex
): CapturedHandoffFragment {
  if (capturedFragment?.stampId !== stampId) {
    return { status: "missing", stampId };
  }
  if (capturedFragment.status !== "valid") return capturedFragment;
  return {
    ...capturedFragment,
    contentSalt: capturedFragment.contentSalt.slice()
  };
}
