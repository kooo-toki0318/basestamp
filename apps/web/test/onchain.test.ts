import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { filterLogsFromAddress } from "../src/lib/onchain";

const registry = "0x6491b8fbb13f7adA916dd81b0834b529285f4edb" as Address;
const other = "0x1111111111111111111111111111111111111111" as Address;

describe("onchain verification helpers", () => {
  it("keeps only logs emitted by the approved Registry", () => {
    const logs = [
      { address: other, marker: "wrapper" },
      { address: registry, marker: "registry" }
    ];

    expect(filterLogsFromAddress(logs, registry)).toEqual([
      { address: registry, marker: "registry" }
    ]);
  });

  it("matches Registry addresses case-insensitively", () => {
    const lowercaseRegistry = registry.toLowerCase() as Address;

    expect(
      filterLogsFromAddress(
        [{ address: lowercaseRegistry, marker: "registry" }],
        registry
      )
    ).toHaveLength(1);
  });
});
