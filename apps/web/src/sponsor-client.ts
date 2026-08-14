import { postJson } from "./api-client";
import {
  createBuilderAttribution,
  type BuilderAttribution
} from "./builder-attribution";
import type { Translate } from "./i18n-context";
import type { SupportedChainId } from "./lib/networks";
import {
  createSponsorIdempotencyKey,
  type SponsorGrantResponse
} from "./lib/sponsor";

export type SponsorGrantRequest = {
  chainId: SupportedChainId;
  idempotencyKey?: string;
  turnstileToken: string;
};

export function requestSponsorGrant(
  request: SponsorGrantRequest,
  t: Translate
): Promise<SponsorGrantResponse> {
  return postJson<SponsorGrantResponse>(
    "/api/sponsor/grant",
    {
      chainId: request.chainId,
      idempotencyKey:
        request.idempotencyKey ?? createSponsorIdempotencyKey(),
      turnstileToken: request.turnstileToken
    },
    t
  );
}

export function readTurnstileSiteKey(): string | undefined {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? "";
  return siteKey === "" ? undefined : siteKey;
}

export function readBuilderAttribution(): BuilderAttribution | undefined {
  return createBuilderAttribution(import.meta.env.VITE_BASE_BUILDER_CODE);
}

export function readSponsorshipEnabled(): boolean {
  return import.meta.env.VITE_SPONSOR_ENABLED === "true";
}
