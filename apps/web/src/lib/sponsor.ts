export const SPONSOR_TURNSTILE_ACTION = "sponsor_stamp";
export const SPONSOR_GRANT_TTL_SECONDS = 5 * 60;

export type SponsorGrantResponse = {
  claimId: string;
  expiresAt: string;
  grantToken: string;
};

export function createSponsorIdempotencyKey(): string {
  return crypto.randomUUID();
}
