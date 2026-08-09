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
| Smart-account signature confusion | Viem public-client verification for EOA, ERC-1271, and ERC-6492 |
| Secret or personal-data leakage | No request-body logging, generic errors, no raw IP persistence |
| File upload or accidental exfiltration | No upload route; file bytes and salts are handled only in the browser |

## Out of scope

Turnstile, rate limiting, cleanup scheduling and alerting, sponsor grants,
x402, and Mainnet writes remain disabled. Placeholder tables and feature flags
do not enable those capabilities.
