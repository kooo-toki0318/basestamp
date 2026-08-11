export type CreateWalletState =
  | "disconnected"
  | "wrong-network"
  | "authentication-required"
  | "ready";

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
