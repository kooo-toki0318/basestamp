export type CreateWalletState = "disconnected" | "wrong-network" | "ready";

export type CreateConfirmationState = "idle" | "confirming" | "retry";

export type CreateFundingMode = "sponsored" | "wallet-paid";
export type SponsorCapabilityState =
  | "not-configured"
  | "checking"
  | "supported"
  | "unsupported";

export function getCreateWalletState(
  connected: boolean,
  walletChainId: number | undefined,
  selectedChainId: number
): CreateWalletState {
  if (!connected) return "disconnected";
  if (walletChainId !== selectedChainId) return "wrong-network";
  return "ready";
}

export function getCreateConfirmationState(
  hasPendingConfirmation: boolean,
  busy: boolean
): CreateConfirmationState {
  if (!hasPendingConfirmation) return "idle";
  return busy ? "confirming" : "retry";
}

export function getCreateFundingMode(
  sponsorshipAvailable: boolean,
  walletFeeChosen: boolean
): CreateFundingMode {
  return sponsorshipAvailable && !walletFeeChosen
    ? "sponsored"
    : "wallet-paid";
}

export function getSponsorCapabilityState(
  configured: boolean,
  resolved: boolean,
  supported: boolean,
  failed: boolean
): SponsorCapabilityState {
  if (!configured) return "not-configured";
  if (!resolved && !failed) return "checking";
  return supported ? "supported" : "unsupported";
}
