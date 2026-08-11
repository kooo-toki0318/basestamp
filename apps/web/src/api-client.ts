import type {
  MessageKey,
  Translate
} from "./i18n-context";

const API_ERROR_KEYS: Readonly<Record<string, MessageKey>> = {
  authentication_required: "api.authenticationRequired",
  auth_not_configured: "api.authNotConfigured",
  counterfactual_not_allowed: "api.counterfactualNotAllowed",
  handoff_challenge_invalid: "api.handoffChallengeInvalid",
  handoff_signature_invalid: "api.handoffSignatureInvalid",
  internal_error: "api.internalError",
  invalid_authentication: "api.invalidAuthentication",
  invalid_body: "api.invalidRequest",
  invalid_handoff: "api.invalidHandoff",
  invalid_json: "api.invalidRequest",
  not_found: "api.notFound",
  origin_rejected: "api.originRejected",
  payload_too_large: "api.payloadTooLarge",
  invalid_sponsor_request: "api.invalidSponsorRequest",
  sponsor_not_configured: "api.sponsorNotConfigured",
  sponsor_account_rejected: "api.sponsorAccountRejected",
  sponsor_provider_rejected: "api.sponsorProviderRejected",
  sponsor_provider_unavailable: "api.sponsorProviderUnavailable",
  sponsor_quota_exceeded: "api.sponsorQuotaExceeded",
  sponsor_request_rejected: "api.sponsorRequestRejected",
  sponsor_request_conflict: "api.sponsorRequestConflict",
  sponsor_unavailable: "api.sponsorUnavailable",
  turnstile_rejected: "api.turnstileRejected",
  unsupported_chain: "api.unsupportedChain",
  unsupported_media_type: "api.invalidRequest"
};

export async function parseJsonResponse<T>(
  response: Response,
  t: Translate
): Promise<T> {
  const value = (await response.json()) as
    | T
    | { error?: { code?: string; message?: string } };
  if (!response.ok) {
    const errorValue = value as {
      error?: { code?: string; message?: string };
    };
    const code = errorValue.error?.code;
    const messageKey = code === undefined ? undefined : API_ERROR_KEYS[code];
    const message =
      messageKey === undefined
        ? (errorValue.error?.message ?? t("api.requestFailed"))
        : t(messageKey);
    throw new Error(message);
  }
  return value as T;
}

export async function postJson<T>(
  path: string,
  body: Record<string, unknown>,
  t: Translate
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return parseJsonResponse<T>(response, t);
}
