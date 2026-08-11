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

For `/handoff/{stampId}#k=...`, the fragment is parsed before React starts,
copied into browser memory, and removed with the History API. The fragment and
content salt are never included in a Worker or RPC request. QR generation and
Web Share happen locally only after an explicit user action. Handoff Receipt
JSON contains the signed commitment and challenge, but not the content salt.

## Core Worker

The Worker accepts only bounded authentication payloads, stamp IDs, one-time
acknowledgement nonces, and wallet signatures. It must
not log request bodies, wallet signatures, session tokens, cookies, raw IP
addresses, secrets, or authorization headers. Runtime configuration fixes the
allowed SIWE domain, origin, and Base chain; request headers do not choose them.
The Worker reads the Registry independently, binds each handoff challenge to the
authenticated wallet and Base Sepolia session, and never claims to have observed
the browser-local file match.

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
hashes. Handoff acknowledgement nonces are also stored only as hashes, together
with a stamp ID, statement version, wallet, chain, expiry, and use time. No table
may contain file bytes, file metadata, a content salt, free text, a raw IP
address, a raw session token, or a raw wallet sponsor identity.
The deployed Registry is the canonical source for
stamps; `stamp_refs` is only short-lived UI reference state.

## External systems

The browser uses a fixed Base Sepolia RPC for signature verification, Registry
reads and user-approved writes, and receipt, block, and event checks. Request and
verification-package values cannot select a different RPC or Registry address.
Sponsorship, x402, and Mainnet write flags remain disabled.
