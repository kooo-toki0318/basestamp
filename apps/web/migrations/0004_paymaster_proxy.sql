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

CREATE TABLE sponsor_reservation_assertions (
  claim_id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
) STRICT;
