import { describe, expect, it } from "vitest";
import { isHandoffStepActive } from "../src/handoff-role";

describe("handoff story role marker", () => {
  it("does not mark any step as current on the home page", () => {
    expect(isHandoffStepActive(undefined, undefined)).toBe(false);
    expect(isHandoffStepActive("create", undefined)).toBe(false);
    expect(isHandoffStepActive("verify", undefined)).toBe(false);
  });

  it("marks only the role assigned to a compact page", () => {
    expect(isHandoffStepActive("create", "create")).toBe(true);
    expect(isHandoffStepActive("verify", "create")).toBe(false);
    expect(isHandoffStepActive(undefined, "create")).toBe(false);
  });
});
