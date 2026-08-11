import { postJson } from "./api-client";
import type { Translate } from "./i18n-context";
import {
  createSponsorIdempotencyKey,
  type SponsorGrantResponse
} from "./lib/sponsor";

export type SponsorGrantRequest = {
  chainId: 84532;
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
