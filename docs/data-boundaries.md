# Data boundaries

This document defines the current release data boundary. Any new field, endpoint,
binding, table, analytics integration, or log must be reviewed against it.

## Browser only

The browser is the only component permitted to receive file bytes, file names,
local paths, document text, content salts, or handoff URL fragments. File
commitments and verification comparisons run locally in a dedicated worker.
The application exposes no file upload endpoint.
Verification packages may be cached in the current tab's session storage to
survive same-tab navigation. This browser-only cache is not an archive and does
not replace the downloaded JSON handoff artifact.


## Core Worker

The Worker accepts only bounded authentication payloads. It must
not log request bodies, wallet signatures, session tokens, cookies, raw IP
addresses, secrets, or authorization headers. Runtime configuration fixes the
allowed SIWE domain, origin, and Base chain; request headers do not choose them.

## Core D1

D1 is limited to the seven tables in the initial migration:

- `auth_nonces`
- `sessions`
- `stamp_refs`
- `handoff_challenges`
- `sponsor_claims`
- `quota_counters`
- `rate_limit_buckets`

Authentication nonces and session tokens are stored only as cryptographic
hashes. No table may contain file bytes, file metadata, a content salt, free
text, a raw IP address, a raw session token, or a raw wallet sponsor identity.
The deployed Registry is the canonical source for
stamps; `stamp_refs` is only short-lived UI reference state.

## External systems

The browser uses a fixed Base Sepolia RPC for signature verification, Registry
reads and user-approved writes, and receipt, block, and event checks. Request and
verification-package values cannot select a different RPC or Registry address.
Sponsorship, x402, and Mainnet write flags remain disabled.
