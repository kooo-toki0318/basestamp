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
acknowledgement nonces, wallet signatures, Turnstile grant requests, and strict
ERC-7677 Paymaster JSON-RPC payloads. It must
not log request bodies, wallet signatures, session tokens, cookies, raw IP
addresses, secrets, or authorization headers. Runtime configuration fixes the
allowed SIWE domain, origin, and Base chain; request headers do not choose them.
The Worker reads the Registry independently, binds each handoff challenge to the
authenticated wallet and Base Sepolia session, and never claims to have observed
the browser-local file match.

## Core D1

D1 is limited to these nine reviewed tables:

- `auth_nonces`
- `sessions`
- `stamp_refs`
- `handoff_challenges`
- `sponsor_claims`
- `quota_counters`
- `rate_limit_buckets`
- `sponsor_wallet_allowlist`
- `sponsor_reservation_assertions`

Authentication nonces and session tokens are stored only as cryptographic
hashes. Handoff acknowledgement nonces are also stored only as hashes, together
with a stamp ID, statement version, wallet, chain, expiry, and use time. No table
may contain file bytes, file metadata, a content salt, free text, a raw IP
address, or a raw session token. A raw wallet sponsor identity is prohibited
except for the narrow operator test-wallet exception below.
The deployed Registry is the canonical source for
stamps; `stamp_refs` is only short-lived UI reference state.

The eighth durable table is a reviewed exception to the original seven-table
boundary:
`sponsor_wallet_allowlist` contains only a lowercase Base Sepolia test-wallet
address, fixed chain and action, and creation/expiry timestamps. It exists so a
small number of operator-owned test wallets can bypass the monthly wallet
quota without weakening Turnstile, call validation, or daily quotas. It cannot
contain notes or user-supplied text, has no Mainnet chain option, and expired
rows are removed by scheduled cleanup. Production users must never be added.
The ninth table, `sponsor_reservation_assertions`, is a transaction-local D1
guard used to force an atomic batch rollback when any quota assertion fails.
Its rows contain only a claim ID and boolean validity marker and are deleted in
the same successful batch; they are not retained application data.

Core retention is enforced hourly:

| Data | Maximum retention |
| --- | --- |
| Authentication nonces | 48 hours after expiry |
| Active or revoked sessions | 48 hours after expiry or revocation |
| Stamp UI references | 7 days after creation |
| Handoff challenges | 48 hours after expiry |
| Sponsor grant, idempotency, and minimal CDP response | 30 days after terminal state |
| Daily quota counters | 48 hours after the UTC day ends |
| Monthly budget counters | 62 days after the month ends |
| HMAC IP buckets | Until their fixed expiry, at most 48 hours |
| Test-wallet allowlist | Until its mandatory expiry |

After 30 days, a successful sponsor claim is removed. The HMAC wallet quota is
kept only in its monthly aggregate counter, which is removed no later than 62
days after that UTC month ends and is not treated as anonymous data.
`/api/health/retention` reports whether the hourly cleanup has succeeded within
its two-hour service window.

## External systems

The browser uses a fixed Base Sepolia RPC for signature verification, Registry
reads and user-approved writes, and receipt, block, and event checks. Request and
verification-package values cannot select a different RPC or Registry address.
The CDP URL remains Worker-only, and the Worker removes its internal grant
token before forwarding a validated request. The browser-facing Paymaster
route allows cross-origin requests only from exact configured Base Account
popup origins and does not allow cookies. Base Sepolia sponsorship is enabled
for release validation; x402 and Mainnet write flags remain disabled until
their release gates pass.
