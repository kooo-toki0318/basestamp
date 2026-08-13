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
| Diagnostic telemetry leakage | Invocation logs and traces disabled; application error logs use fixed events and bounded route classes without request values; scheduled rejections are contained |
| File upload or accidental exfiltration | No upload route; file bytes and salts are handled only in the browser |
| Paymaster credential abuse | Worker-only CDP URL, short-lived wallet-bound grant, deep UserOperation decoding, and a second CDP contract/function policy |
| Cross-origin Paymaster abuse | Exact Base Account popup-origin allowlist on the Paymaster route; POST and Content-Type only; no credentialed CORS |
| Sponsor quota races | Atomic D1 reservation with wallet-month, HMAC IP-day, and service-day assertions before provider forwarding |
| Wallet-selected fee-path confusion | Wallet capability detection, non-optional app Paymaster request, no automatic wallet-paid fallback, and live D1 confirmation required for release evidence |

## Out of scope

x402 and Mainnet writes remain disabled. Base Sepolia sponsorship is enabled
only for release validation and includes Turnstile, sponsor grants, rate
limits, hourly cleanup, and retention health. A successful wallet transaction
alone does not prove that BaseStamp's Paymaster was used; release evidence must
also show the matching D1 claim reached its sponsored state.
