ALTER TABLE sponsor_claims
  ADD COLUMN reserved_wallet_key TEXT CHECK (
    reserved_wallet_key IS NULL OR length(reserved_wallet_key) = 64
  );

ALTER TABLE sponsor_claims
  ADD COLUMN request_ip_bucket_key TEXT CHECK (
    request_ip_bucket_key IS NULL OR length(request_ip_bucket_key) = 64
  );

ALTER TABLE sponsor_claims
  ADD COLUMN request_day_start INTEGER;

ALTER TABLE sponsor_claims
  ADD COLUMN request_method TEXT CHECK (
    request_method IS NULL OR request_method IN (
      'pm_getPaymasterStubData',
      'pm_getPaymasterData'
    )
  );

ALTER TABLE sponsor_claims
  ADD COLUMN request_fingerprint_hash TEXT CHECK (
    request_fingerprint_hash IS NULL OR length(request_fingerprint_hash) = 64
  );

ALTER TABLE sponsor_claims
  ADD COLUMN requested_at INTEGER;

ALTER TABLE sponsor_claims
  ADD COLUMN stub_fingerprint_hash TEXT CHECK (
    stub_fingerprint_hash IS NULL OR length(stub_fingerprint_hash) = 64
  );

ALTER TABLE sponsor_claims
  ADD COLUMN stub_response_json TEXT CHECK (
    stub_response_json IS NULL OR length(stub_response_json) <= 20000
  );

ALTER TABLE sponsor_claims
  ADD COLUMN provider_response_json TEXT CHECK (
    provider_response_json IS NULL OR length(provider_response_json) <= 20000
  );

ALTER TABLE sponsor_claims
  ADD COLUMN wallet_lifetime_bypassed INTEGER NOT NULL DEFAULT 0 CHECK (
    wallet_lifetime_bypassed IN (0, 1)
  );

CREATE TABLE sponsor_wallet_allowlist (
  wallet_address TEXT NOT NULL CHECK (
    length(wallet_address) = 42
    AND wallet_address = lower(wallet_address)
  ),
  chain_id INTEGER NOT NULL CHECK (chain_id = 84532),
  action TEXT NOT NULL CHECK (action = 'sponsor_stamp'),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (wallet_address, chain_id, action)
) STRICT;

CREATE INDEX sponsor_wallet_allowlist_expiry_idx
  ON sponsor_wallet_allowlist (expires_at);

CREATE UNIQUE INDEX sponsor_claims_reserved_wallet_idx
  ON sponsor_claims (reserved_wallet_key, chain_id, action)
  WHERE reserved_wallet_key IS NOT NULL;

CREATE INDEX sponsor_claims_requested_idx
  ON sponsor_claims (status, requested_at);

CREATE TRIGGER sponsor_claims_reserve_quota
BEFORE UPDATE OF status ON sponsor_claims
WHEN OLD.status = 'grant_issued' AND NEW.status = 'requested'
BEGIN
  INSERT INTO rate_limit_buckets (
    bucket_key,
    window_start,
    count,
    expires_at,
    updated_at
  ) VALUES (
    NEW.request_ip_bucket_key,
    NEW.request_day_start,
    1,
    NEW.request_day_start + 172800,
    NEW.requested_at
  )
  ON CONFLICT(bucket_key) DO UPDATE SET
    count = rate_limit_buckets.count + 1,
    updated_at = excluded.updated_at
  WHERE rate_limit_buckets.window_start = excluded.window_start
    AND rate_limit_buckets.count < 3;

  SELECT CASE WHEN changes() != 1
    THEN RAISE(ABORT, 'sponsor_ip_quota')
  END;

  INSERT INTO quota_counters (
    counter_key,
    period_kind,
    period_start,
    count,
    updated_at
  ) VALUES (
    'sponsor:global:day:' || NEW.request_day_start,
    'day',
    NEW.request_day_start,
    1,
    NEW.requested_at
  )
  ON CONFLICT(counter_key) DO UPDATE SET
    count = quota_counters.count + 1,
    updated_at = excluded.updated_at
  WHERE quota_counters.period_kind = 'day'
    AND quota_counters.period_start = excluded.period_start
    AND quota_counters.count < 10;

  SELECT CASE WHEN changes() != 1
    THEN RAISE(ABORT, 'sponsor_global_quota')
  END;
END;

CREATE TRIGGER sponsor_claims_release_quota
AFTER UPDATE OF status ON sponsor_claims
WHEN OLD.status = 'requested'
  AND NEW.status IN ('grant_issued', 'denied')
BEGIN
  UPDATE rate_limit_buckets
  SET count = count - 1,
      updated_at = COALESCE(NEW.terminal_at, NEW.requested_at, OLD.requested_at)
  WHERE bucket_key = OLD.request_ip_bucket_key
    AND count > 0;

  UPDATE quota_counters
  SET count = count - 1,
      updated_at = COALESCE(NEW.terminal_at, NEW.requested_at, OLD.requested_at)
  WHERE counter_key = 'sponsor:global:day:' || OLD.request_day_start
    AND count > 0;
END;
