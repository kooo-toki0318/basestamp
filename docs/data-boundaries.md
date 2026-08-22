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
authenticated wallet and selected supported Base-chain session, and never
claims to have observed the browser-local file match.
Persisted invocation logs are disabled. Application error paths emit only a
fixed event name and, for HTTP errors, the method and bounded route class;
scheduled-cleanup failures emit only a fixed event. BaseStamp does not put
messages, stack traces, full paths, query strings, request bodies, IP addresses,
wallet values, signatures, tokens, or provider URLs in custom logs. Automatic
traces remain disabled because outbound provider URLs are confidential
configuration. Cloudflare can still process platform and edge metadata under
its service boundary independently of BaseStamp's custom log fields.

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
address, or a raw session token. Sponsor claims retain only bounded grant and
claim state, hashed tokens, wallet/chain binding, idempotency and request
fingerprints, concurrency state, and minimal Paymaster response data.
The deployed Registry is the canonical source for
stamps; `stamp_refs` is only short-lived UI reference state.

`quota_counters`, `rate_limit_buckets`, `sponsor_wallet_allowlist`, and
`sponsor_reservation_assertions` are legacy schema retained for migration and
cleanup compatibility. They are not used to count sponsored transactions or to
decide current sponsorship eligibility. Existing allowlist rows contain a raw
test-wallet address, chain, action, and creation/expiry timestamps and are
removed when expired; production users must not be added. Reservation assertion
rows contain only a claim ID and boolean validity marker and are not retained
application data. Paymaster stub and final-data RPC calls can both occur while
one wallet transaction is being prepared and are not treated as transactions.

Core retention is enforced hourly:

| Data | Maximum retention |
| --- | --- |
| Authentication nonces | 48 hours after expiry |
| Active or revoked sessions | 48 hours after expiry or revocation |
| Stamp UI references | 7 days after creation |
| Handoff challenges | 48 hours after expiry |
| Sponsor grants, claims, request fingerprints, concurrency state, and minimal CDP responses | 30 days after terminal state |
| Legacy daily counter or bucket rows, if present | 48 hours after their recorded period |
| Legacy monthly counter rows, if present | 62 days after their recorded month |
| Legacy test-wallet allowlist rows | Until their mandatory expiry |

After 30 days, a terminal sponsor claim is removed. CDP Paymaster policy, not
these legacy D1 tables, determines sponsorship eligibility and limits.
`/api/health/retention` reports whether the hourly cleanup has succeeded within
its two-hour service window.

## External systems

The browser selects only the reviewed Base Mainnet or Base Sepolia deployment,
then uses its fixed RPC and Registry for signature verification, reads,
user-approved writes, receipt, block, and event checks. Request and imported
package values cannot select an arbitrary RPC or Registry. The CDP URL remains
Worker-only, and the Worker removes its internal grant token before forwarding
a validated request. The browser-facing Paymaster route allows cross-origin
requests only from exact configured Base Account popup origins and does not
allow cookies. Mainnet and Sepolia sponsorship are enabled behind independent
browser, Worker, and CDP policy gates. x402 remains disabled.
