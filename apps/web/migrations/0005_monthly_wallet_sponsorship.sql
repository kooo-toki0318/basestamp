ALTER TABLE sponsor_claims
  ADD COLUMN request_month_start INTEGER;

DELETE FROM sponsor_claims
  WHERE status = 'marker';

UPDATE sponsor_claims
  SET wallet_sponsor_key = NULL
  WHERE status = 'sponsored';

DROP INDEX sponsor_claims_wallet_action_idx;
DROP INDEX sponsor_claims_reserved_wallet_idx;

CREATE INDEX sponsor_claims_request_month_idx
  ON sponsor_claims (request_month_start)
  WHERE request_month_start IS NOT NULL;
