import { describe, expect, it } from "vitest";
import {
  DEFAULT_BASE_CHAIN_ID,
  isMainnetWriteFlagEnabled,
  isRegistryWriteAvailable
} from "../src/lib/networks";

describe("Registry write release gates", () => {
  it("uses Base Mainnet as the initial application network", () => {
    expect(DEFAULT_BASE_CHAIN_ID).toBe(8453);
  });

  it("treats only the exact public build flag as enabled", () => {
    expect(isMainnetWriteFlagEnabled(undefined)).toBe(false);
    expect(isMainnetWriteFlagEnabled("false")).toBe(false);
    expect(isMainnetWriteFlagEnabled("TRUE")).toBe(false);
    expect(isMainnetWriteFlagEnabled("true")).toBe(true);
  });

  it("keeps Mainnet closed unless both deployment and build gates pass", () => {
    expect(isRegistryWriteAvailable(8453, false, false)).toBe(false);
    expect(isRegistryWriteAvailable(8453, true, false)).toBe(false);
    expect(isRegistryWriteAvailable(8453, false, true)).toBe(false);
    expect(isRegistryWriteAvailable(8453, true, true)).toBe(true);
  });

  it("allows the reviewed Sepolia deployment independently of Mainnet", () => {
    expect(isRegistryWriteAvailable(84532, true, false)).toBe(true);
    expect(isRegistryWriteAvailable(84532, false, true)).toBe(false);
  });
});
