import { describe, expect, it } from "vitest";
import { BASE_SEPOLIA_DEPLOYMENT } from "../src/lib/deployment";
import { createSponsoredStampCall } from "../src/sponsored-stamp";

const CONTENT = `0x${"11".repeat(32)}` as const;
const METADATA = `0x${"22".repeat(32)}` as const;
const NONCE = `0x${"33".repeat(32)}` as const;

describe("sponsored stamp call", () => {
  it("pins one atomic Registry call and a non-optional local paymaster", () => {
    const request = createSponsoredStampCall({
      account: "0x1111111111111111111111111111111111111111",
      contentCommitment: CONTENT,
      grant: {
        claimId: "11111111-1111-4111-8111-111111111111",
        expiresAt: "2026-08-11T09:00:00Z",
        grantToken: "a".repeat(43)
      },
      metadataHash: METADATA,
      origin: "https://basestamp.example",
      stampNonce: NONCE
    });

    expect(request.chainId).toBe(84532);
    expect(request.forceAtomic).toBe(true);
    expect(request.calls).toHaveLength(1);
    expect(request.calls[0].to).toBe(
      BASE_SEPOLIA_DEPLOYMENT.registryAddress
    );
    expect(request.calls[0].functionName).toBe("createStamp");
    expect(request.calls[0].args).toEqual([CONTENT, METADATA, NONCE]);
    expect(request.capabilities.paymasterService).toEqual({
      context: {
        claimId: "11111111-1111-4111-8111-111111111111",
        grantToken: "a".repeat(43)
      },
      optional: false,
      url: "https://basestamp.example/api/sponsor"
    });
  });
});
