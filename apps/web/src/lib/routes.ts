import type { Hex } from "viem";
import {
  isSupportedChainId,
  type SupportedChainId
} from "./networks";

export type StampRoute = {
  chainId: SupportedChainId;
  stampId: Hex;
};

const STAMP_ID_SOURCE = "(0x[0-9a-fA-F]{64})";

function parseRoute(
  pathname: string,
  prefix: "handoff" | "stamps"
): StampRoute | undefined {
  const chainAware = new RegExp(
    `^/${prefix}/(8453|84532)/${STAMP_ID_SOURCE}/?$`,
    "u"
  ).exec(pathname);
  if (chainAware?.[1] !== undefined && chainAware[2] !== undefined) {
    const chainId = Number(chainAware[1]);
    if (!isSupportedChainId(chainId)) return undefined;
    return {
      chainId,
      stampId: chainAware[2].toLowerCase() as Hex
    };
  }

  const legacy = new RegExp(`^/${prefix}/${STAMP_ID_SOURCE}/?$`, "u").exec(
    pathname
  );
  if (legacy?.[1] === undefined) return undefined;
  return {
    chainId: 84532,
    stampId: legacy[1].toLowerCase() as Hex
  };
}

export function parseStampRoute(pathname: string): StampRoute | undefined {
  return parseRoute(pathname, "stamps");
}

export function parseHandoffRoute(pathname: string): StampRoute | undefined {
  return parseRoute(pathname, "handoff");
}

export function createStampPath(chainId: SupportedChainId, stampId: Hex): string {
  return `/stamps/${String(chainId)}/${stampId}`;
}

export function createHandoffPath(
  chainId: SupportedChainId,
  stampId: Hex
): string {
  return `/handoff/${String(chainId)}/${stampId}`;
}
