import { Attribution } from "ox/erc8021";
import type { Hex } from "viem";

const BUILDER_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

export type BuilderAttribution = {
  code: string;
  dataSuffix: Hex;
};

export function createBuilderAttribution(
  code: string | undefined
): BuilderAttribution | undefined {
  const normalized = code?.trim() ?? "";
  if (!BUILDER_CODE_PATTERN.test(normalized)) return undefined;
  return {
    code: normalized,
    dataSuffix: Attribution.toDataSuffix({ codes: [normalized] })
  };
}
