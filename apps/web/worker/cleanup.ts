const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const REQUEST_RECOVERY_SECONDS = 5 * 60;
const SHORT_LIVED_RETENTION_SECONDS = 2 * DAY_SECONDS;
const STAMP_REFERENCE_RETENTION_SECONDS = 7 * DAY_SECONDS;
const SPONSOR_TRANSIENT_RETENTION_SECONDS = 30 * DAY_SECONDS;
const CLEANUP_MAX_AGE_SECONDS = 2 * HOUR_SECONDS;
const CLEANUP_STATUS_KEY = "system:cleanup:last_success";

export type CleanupHealth = {
  healthy: boolean;
  lastSuccessAt: string | null;
};

type CleanupStatusRow = { updated_at: number };

export async function readCleanupHealth(
  database: D1Database,
  now = Math.floor(Date.now() / 1_000)
): Promise<CleanupHealth> {
  const row = await database.prepare(
    "SELECT updated_at FROM quota_counters WHERE counter_key = ?"
  )
    .bind(CLEANUP_STATUS_KEY)
    .first<CleanupStatusRow>();
  const updatedAt = row?.updated_at;
  return {
    healthy:
      updatedAt !== undefined &&
      updatedAt <= now + 60 &&
      updatedAt > now - CLEANUP_MAX_AGE_SECONDS,
    lastSuccessAt:
      updatedAt === undefined
        ? null
        : new Date(updatedAt * 1_000).toISOString().replace(".000Z", "Z")
  };
}

export async function runCoreCleanup(
  database: D1Database,
  now = Math.floor(Date.now() / 1_000)
): Promise<void> {
  const shortLivedCutoff = now - SHORT_LIVED_RETENTION_SECONDS;
  const stampReferenceCutoff = now - STAMP_REFERENCE_RETENTION_SECONDS;
  const sponsorTransientCutoff = now - SPONSOR_TRANSIENT_RETENTION_SECONDS;
  const staleRequestCutoff = now - REQUEST_RECOVERY_SECONDS;

  await database.batch([
    database.prepare(
      "UPDATE sponsor_claims SET status = 'grant_issued', " +
        "reserved_wallet_key = NULL, request_ip_bucket_key = NULL, " +
        "request_day_start = NULL, request_method = NULL, " +
        "request_fingerprint_hash = NULL, requested_at = NULL, " +
        "wallet_lifetime_bypassed = 0 " +
        "WHERE status = 'requested' AND requested_at <= ?"
    ).bind(staleRequestCutoff),
    database.prepare(
      "UPDATE sponsor_claims SET status = 'expired', " +
        "terminal_at = grant_expires_at " +
        "WHERE status = 'grant_issued' AND grant_expires_at <= ?"
    ).bind(now),
    database.prepare(
      "UPDATE sponsor_claims SET status = 'marker', grant_wallet_key = NULL, " +
        "idempotency_key_hash = NULL, grant_token_hash = NULL, " +
        "grant_expires_at = NULL, turnstile_verified_at = NULL, " +
        "provider_reference_hash = NULL, provider_response_json = NULL, " +
        "reserved_wallet_key = NULL, request_ip_bucket_key = NULL, " +
        "request_day_start = NULL, request_method = NULL, " +
        "request_fingerprint_hash = NULL, requested_at = NULL, " +
        "stub_fingerprint_hash = NULL, stub_response_json = NULL, " +
        "wallet_lifetime_bypassed = 0, terminal_at = NULL " +
        "WHERE status = 'sponsored' AND wallet_sponsor_key IS NOT NULL " +
        "AND terminal_at <= ?"
    ).bind(sponsorTransientCutoff),
    database.prepare(
      "DELETE FROM sponsor_claims WHERE wallet_sponsor_key IS NULL " +
        "AND terminal_at IS NOT NULL AND terminal_at <= ?"
    ).bind(sponsorTransientCutoff),
    database.prepare(
      "DELETE FROM auth_nonces WHERE expires_at <= ?"
    ).bind(shortLivedCutoff),
    database.prepare(
      "DELETE FROM sessions WHERE CASE WHEN revoked_at IS NULL " +
        "THEN expires_at ELSE revoked_at END <= ?"
    ).bind(shortLivedCutoff),
    database.prepare(
      "DELETE FROM stamp_refs WHERE created_at <= ?"
    ).bind(stampReferenceCutoff),
    database.prepare(
      "DELETE FROM handoff_challenges WHERE expires_at <= ?"
    ).bind(shortLivedCutoff),
    database.prepare(
      "DELETE FROM rate_limit_buckets WHERE expires_at <= ?"
    ).bind(now),
    database.prepare(
      "DELETE FROM quota_counters WHERE counter_key != ? AND " +
        "((period_kind = 'day' AND period_start + 259200 <= ?) OR " +
        "(period_kind = 'month' AND unixepoch(datetime(period_start, " +
        "'unixepoch', 'start of month', '+1 month', '+62 days')) <= ?))"
    ).bind(CLEANUP_STATUS_KEY, now, now),
    database.prepare(
      "DELETE FROM sponsor_wallet_allowlist WHERE expires_at <= ?"
    ).bind(now),
    database.prepare(
      "INSERT INTO quota_counters " +
        "(counter_key, period_kind, period_start, count, updated_at) " +
        "VALUES (?, 'day', ?, 0, ?) " +
        "ON CONFLICT(counter_key) DO UPDATE SET " +
        "period_start = excluded.period_start, count = 0, " +
        "updated_at = excluded.updated_at"
    ).bind(CLEANUP_STATUS_KEY, now, now)
  ]);
}
