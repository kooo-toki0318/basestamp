import { describe, expect, it } from "vitest";
import {
  getCreateHandoffStep,
  isHandoffStepActive
} from "../src/handoff-role";

describe("handoff story role marker", () => {
  it("does not mark any step as current on the home page", () => {
    expect(isHandoffStepActive(1, undefined, undefined)).toBe(false);
    expect(isHandoffStepActive(1, "create", undefined)).toBe(false);
    expect(isHandoffStepActive(4, "verify", undefined)).toBe(false);
  });

  it("marks only the role assigned to a compact page", () => {
    expect(isHandoffStepActive(1, "create", "create")).toBe(true);
    expect(isHandoffStepActive(4, "verify", "create")).toBe(false);
    expect(isHandoffStepActive(2, undefined, "create")).toBe(false);
  });

  it("lets Create advance from authentication to recording and sharing", () => {
    expect(getCreateHandoffStep(false, false)).toBe(1);
    expect(getCreateHandoffStep(true, false)).toBe(2);
    expect(getCreateHandoffStep(true, true)).toBe(3);
    expect(isHandoffStepActive(2, undefined, "create", 2)).toBe(true);
    expect(isHandoffStepActive(1, "create", "create", 2)).toBe(false);
  });
});
