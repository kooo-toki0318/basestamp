PRAGMA foreign_keys = ON;

CREATE TABLE auth_nonces (
  nonce_hash TEXT PRIMARY KEY NOT NULL CHECK (length(nonce_hash) = 64),
  domain TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX auth_nonces_expiry_idx
  ON auth_nonces (expires_at);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64),
  wallet_address TEXT NOT NULL CHECK (
    length(wallet_address) = 42
    AND wallet_address = lower(wallet_address)
  ),
  chain_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX sessions_expiry_idx
  ON sessions (expires_at);

CREATE TABLE stamp_refs (
  stamp_id TEXT PRIMARY KEY NOT NULL CHECK (length(stamp_id) = 66),
  chain_id INTEGER NOT NULL,
  contract_address TEXT NOT NULL CHECK (
    length(contract_address) = 42
    AND contract_address = lower(contract_address)
  ),
  transaction_hash TEXT NOT NULL CHECK (length(transaction_hash) = 66),
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX stamp_refs_created_idx
  ON stamp_refs (created_at);

CREATE TABLE handoff_challenges (
  ack_nonce_hash TEXT PRIMARY KEY NOT NULL CHECK (length(ack_nonce_hash) = 64),
  stamp_id TEXT NOT NULL CHECK (length(stamp_id) = 66),
  statement_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX handoff_challenges_expiry_idx
  ON handoff_challenges (expires_at);

CREATE TABLE sponsor_claims (
  claim_id TEXT PRIMARY KEY NOT NULL,
  wallet_sponsor_key TEXT CHECK (
    wallet_sponsor_key IS NULL OR length(wallet_sponsor_key) = 64
  ),
  chain_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  provider_reference_hash TEXT CHECK (
    provider_reference_hash IS NULL OR length(provider_reference_hash) = 64
  ),
  sponsored_at INTEGER,
  terminal_at INTEGER,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX sponsor_claims_terminal_idx
  ON sponsor_claims (terminal_at);

CREATE UNIQUE INDEX sponsor_claims_wallet_action_idx
  ON sponsor_claims (wallet_sponsor_key, chain_id, action)
  WHERE wallet_sponsor_key IS NOT NULL;

CREATE TABLE quota_counters (
  counter_key TEXT PRIMARY KEY NOT NULL,
  period_kind TEXT NOT NULL CHECK (period_kind IN ('day', 'month')),
  period_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX quota_counters_period_idx
  ON quota_counters (period_kind, period_start);

CREATE TABLE rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY NOT NULL CHECK (length(bucket_key) = 64),
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX rate_limit_buckets_expiry_idx
  ON rate_limit_buckets (expires_at);
