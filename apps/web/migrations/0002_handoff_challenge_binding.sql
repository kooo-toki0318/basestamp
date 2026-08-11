ALTER TABLE handoff_challenges
  ADD COLUMN wallet_address TEXT CHECK (
    wallet_address IS NULL
    OR (
      length(wallet_address) = 42
      AND wallet_address = lower(wallet_address)
    )
  );

ALTER TABLE handoff_challenges
  ADD COLUMN chain_id INTEGER CHECK (
    chain_id IS NULL OR chain_id IN (8453, 84532)
  );

CREATE INDEX handoff_challenges_wallet_expiry_idx
  ON handoff_challenges (wallet_address, expires_at);
