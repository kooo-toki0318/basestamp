export type CreateWalletState =
  | "disconnected"
  | "wrong-network"
  | "authentication-required"
  | "ready";

export type CreateConfirmationState = "idle" | "confirming" | "retry";

export type CreateFundingMode = "sponsored" | "wallet-paid";

export function getCreateWalletState(
  connected: boolean,
  walletChainId: number | undefined,
  selectedChainId: number,
  authenticated: boolean
): CreateWalletState {
  if (!connected) return "disconnected";
  if (walletChainId !== selectedChainId) return "wrong-network";
  return authenticated ? "ready" : "authentication-required";
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
