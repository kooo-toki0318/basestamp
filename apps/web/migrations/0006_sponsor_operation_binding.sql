ALTER TABLE sponsor_claims
  ADD COLUMN operation_fingerprint_hash TEXT CHECK (
    operation_fingerprint_hash IS NULL OR length(operation_fingerprint_hash) = 64
  );
