ALTER TABLE sponsor_claims
  ADD COLUMN grant_wallet_key TEXT CHECK (
    grant_wallet_key IS NULL OR length(grant_wallet_key) = 64
  );

ALTER TABLE sponsor_claims
  ADD COLUMN idempotency_key_hash TEXT CHECK (
    idempotency_key_hash IS NULL OR length(idempotency_key_hash) = 64
  );

ALTER TABLE sponsor_claims
  ADD COLUMN grant_token_hash TEXT CHECK (
    grant_token_hash IS NULL OR length(grant_token_hash) = 64
  );

ALTER TABLE sponsor_claims
  ADD COLUMN grant_expires_at INTEGER;

ALTER TABLE sponsor_claims
  ADD COLUMN turnstile_verified_at INTEGER;

CREATE UNIQUE INDEX sponsor_claims_idempotency_idx
  ON sponsor_claims (idempotency_key_hash)
  WHERE idempotency_key_hash IS NOT NULL;

CREATE UNIQUE INDEX sponsor_claims_grant_token_idx
  ON sponsor_claims (grant_token_hash)
  WHERE grant_token_hash IS NOT NULL;

CREATE INDEX sponsor_claims_grant_expiry_idx
  ON sponsor_claims (status, grant_expires_at);
