# Threat model

## Protected assets

- SIWE nonce uniqueness and single use
- Session confidentiality and server-side revocation
- Fixed authentication origin, domain, and Base chain
- Application and Worker secrets
- The promise that file data never leaves the browser

## Trust boundaries

The browser and wallet are untrusted request initiators. The Cloudflare Worker
validates all input before D1 or RPC use. D1 is trusted only for bounded state,
not as a source of stamp truth. RPC and Registry destinations are fixed by the
application; requests and imported verification packages cannot select them.
Onchain state remains the canonical source for stamps.

## Threats and controls

| Threat | Control |
| --- | --- |
| Nonce replay | CSPRNG nonce, stored hash, short expiry, conditional one-time update |
| SIWE origin confusion | Exact configured domain and URI; Host headers are not trusted |
| Cross-chain authentication | Exact configured Base chain ID |
| Stale or future messages | Required issued-at and expiration with bounded clock skew |
| Session theft | Opaque token, HMAC hash in D1, `__Host-` HttpOnly Secure SameSite cookie |
| CSRF | SameSite cookie plus exact Origin checks on state-changing session endpoints |
| Framing and content sniffing | CSP `frame-ancestors 'none'`, X-Frame-Options, nosniff |
| Oversized or ambiguous JSON | Content-type requirement, body-size bound, exact key sets |
| Handoff-key leakage | Fragment-only key, no-referrer policy, capture and History API removal before app requests, no analytics, explicit-only QR/Web Share |
| False server attestation | Receipt UI states that the Worker never receives the file or salt and verifies only the wallet's signed acknowledgement |
| Handoff challenge replay | CSPRNG nonce hash, ten-minute maximum lifetime, wallet/chain/stamp binding, and conditional one-time consumption |
| Smart-account signature confusion | Block-pinned Viem verification for EOA and ERC-1271; ERC-6492 additionally requires the fixed Base Account factory, implementation, validator, predicted signer, and runtime code hashes |
| Secret or personal-data leakage | No request-body logging, generic errors, no raw IP persistence |
| File upload or accidental exfiltration | No upload route; file bytes and salts are handled only in the browser |

## Out of scope

Turnstile, rate limiting, cleanup scheduling and alerting, sponsor grants,
x402, and Mainnet writes remain disabled. Placeholder tables and feature flags
do not enable those capabilities.
