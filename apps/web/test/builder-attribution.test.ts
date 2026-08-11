import { Attribution } from "ox/erc8021";
import { describe, expect, it } from "vitest";
import { createBuilderAttribution } from "../src/builder-attribution";

describe("Builder attribution", () => {
  it("creates the canonical ERC-8021 suffix for a configured Builder Code", () => {
    const attribution = createBuilderAttribution("bc_o3k81ayl");
    expect(attribution?.code).toBe("bc_o3k81ayl");
    expect(Attribution.fromData(attribution?.dataSuffix ?? "0x")).toEqual({
      codes: ["bc_o3k81ayl"],
      id: 0
    });
  });

  it("rejects missing or malformed Builder Codes", () => {
    expect(createBuilderAttribution(undefined)).toBeUndefined();
    expect(createBuilderAttribution("invalid code")).toBeUndefined();
  });
});
