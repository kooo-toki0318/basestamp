import { describe, expect, it } from "vitest";
import {
  getCreateConfirmationState,
  getCreateWalletState
} from "../src/create-wallet-state";

describe("Create wallet readiness", () => {
  it("requires the live wallet chain to match the selected chain", () => {
    expect(getCreateWalletState(true, 8453, 84532, true)).toBe(
      "wrong-network"
    );
    expect(getCreateWalletState(true, 84532, 84532, true)).toBe("ready");
  });

  it("keeps connection, chain, and authentication as separate gates", () => {
    expect(getCreateWalletState(false, undefined, 84532, false)).toBe(
      "disconnected"
    );
    expect(getCreateWalletState(true, 84532, 84532, false)).toBe(
      "authentication-required"
    );
  });
});

describe("Create transaction confirmation", () => {
  it("shows automatic confirmation while the submitted transaction is busy", () => {
    expect(getCreateConfirmationState(true, true)).toBe("confirming");
  });

  it("offers retry only after automatic confirmation has stopped", () => {
    expect(getCreateConfirmationState(true, false)).toBe("retry");
    expect(getCreateConfirmationState(false, true)).toBe("idle");
  });
});
