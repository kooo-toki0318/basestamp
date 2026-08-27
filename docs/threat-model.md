# Threat model

## Protected assets

- SIWE nonce uniqueness and single use for authenticated Handoff flows
- Session confidentiality and server-side revocation
- Fixed authentication origin, domain, and Base chain
- Sponsor-grant integrity and one-operation binding
- Application and Worker secrets
- The promise that file data never leaves the browser

## Trust boundaries

The browser and wallet are untrusted request initiators. The Cloudflare Worker
validates all input before D1 or RPC use. D1 is trusted only for bounded state,
not as a source of stamp truth. RPC and Registry destinations are fixed by the
application; requests and imported verification packages cannot select them.
Onchain state remains the canonical source for stamps.

Create and Handoff intentionally use different authorization boundaries. Create
does not require a SIWE web session: the wallet authorizes the final onchain
UserOperation, while the sponsorship path separately requires Turnstile and a
short-lived grant bound to the selected wallet, chain, and one stable wallet
operation. Handoff continues to require SIWE because its challenge and Receipt
flow needs an authenticated web session before issuing wallet-bound state.

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
| Connected-grant wallet impersonation | Exact application Origin, Turnstile, wallet/chain-bound HMAC grant key, and re-derivation from the actual ERC-7677 UserOperation sender before provider forwarding; naming another wallet cannot make the grant usable by a different sender |
| Sponsor-grant replay across different operations | The first Paymaster RPC atomically binds the claim to a stable fingerprint of sender, chain, EntryPoint, nonce, and callData; later ERC-7677 retries may change gas/signature/paymaster fields but cannot switch to another operation |
| Paymaster credential abuse | Worker-only CDP URL, short-lived wallet/chain-bound grant, bounded ERC-7677 envelope validation, one-operation binding, and a second CDP contract/function policy |
| Cross-origin Paymaster abuse | Exact Base Account popup-origin allowlist on the Paymaster route; POST and Content-Type only; no credentialed CORS |
| Concurrent Paymaster RPCs for one claim | Atomic per-claim D1 reservation lock; stub and final-data RPCs used to prepare one transaction are not counted as separate transactions |
| Wallet-selected fee-path confusion | Wallet capability detection, non-optional app Paymaster request, no automatic wallet-paid fallback, and live D1 confirmation required for release evidence |

## Out of scope

x402 remains disabled. Base Mainnet and Base Sepolia recording and sponsorship
are enabled behind reviewed build, Worker, and provider-policy gates.
Sponsorship includes Turnstile, wallet/chain-bound grants, one-operation binding,
per-claim concurrency control, hourly cleanup, and retention health. A successful
wallet transaction alone does not prove that BaseStamp's Paymaster was used;
release evidence must also show the matching D1 claim reached its sponsored
state.
