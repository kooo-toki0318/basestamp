import type { Hex } from "viem";
import { parseHandoffFragment } from "./lib/handoff";
import { parseHandoffRoute } from "./lib/routes";

type CapturedHandoffFragment =
  | { status: "missing"; stampId: Hex }
  | { status: "invalid"; stampId: Hex }
  | { status: "valid"; stampId: Hex; contentSalt: Uint8Array };

let capturedFragment: CapturedHandoffFragment | undefined;

export function captureHandoffFragment(): void {
  const route = parseHandoffRoute(window.location.pathname);
  if (route === undefined) return;
  const stampId = route.stampId;

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
