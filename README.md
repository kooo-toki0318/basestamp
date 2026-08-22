# BaseStamp

Private file records and independent verification on Base.

**Live Mainnet app:** [basestamp-web.ndun000.workers.dev](https://basestamp-web.ndun000.workers.dev/)

**Source:** [github.com/kooo-toki0318/basestamp](https://github.com/kooo-toki0318/basestamp)

Base Mainnet is the default network. Base Sepolia remains available for testing.

BaseStamp lets you record that a specific file existed without uploading the
file itself. It creates a salted commitment locally in your browser, stores the
minimum public record on Base, and gives you both a private handoff link and a
portable JSON archive for later verification.

> BaseStamp verifies a match between file bytes and an onchain record. It does
> not prove authorship, ownership, identity, acceptance, or legal validity.

## How it works

### Record a file

1. Choose a file in the browser.
2. Review its local preview and classification.
3. Connect a wallet and sign in.
4. Approve the Base transaction that records the salted commitment.
5. Save the downloaded BaseStamp verification JSON.

The file bytes and file name are not sent to BaseStamp or written onchain.

### Share the handoff

For the simplest recipient flow, send:

- the original file;
- the private BaseStamp handoff link generated after confirmation.

The link contains the private comparison key after its URL fragment marker
(`#`). Share it only through a channel you trust. Keep the downloaded
verification JSON as a portable archive; the classic JSON-based verification
flow remains available.

### Verify a received file

1. Open the complete private handoff link.
2. Select the received file.
3. BaseStamp checks the approved Registry and compares the file locally.
4. After a match, optionally connect and authenticate a wallet to sign and
   download a local Handoff Receipt.

The file-match check does not require a wallet. The optional Receipt records a
wallet's statement that it observed a local match; it is not independent proof
of the file bytes, identity, acceptance, or legal validity. A recipient can
still open `/verify` and use the verification JSON instead.

## Useful when the exact file matters

- **Creative delivery:** hand off a design, photograph, audio master, or draft
  with a reproducible integrity check.
- **Document delivery:** accompany a report, agreement draft, or certificate
  with evidence that the recipient has the exact recorded file.
- **Release evidence:** record a build artifact, dataset, research output, or
  publication before distribution.

## Privacy model

BaseStamp is local-first:

- file bytes are processed in a dedicated browser worker;
- original files are never uploaded by the application;
- only the creator, timestamp, salted commitment, and fixed metadata hash are
  public onchain;
- the verification JSON contains the salt needed for comparison and should be
  shared only with intended recipients;
- the private handoff link contains that salt only in its URL fragment, which
  is captured before app requests, removed from the address bar, and never sent
  to the Worker, D1, RPC, or logs;
- Handoff Receipts do not contain the content salt and are downloaded locally;
- browser session storage is only a navigation convenience, not permanent
  package storage.

Read the detailed [data boundaries](docs/data-boundaries.md),
[authentication threat model](docs/threat-model.md), and
[Registry security boundary](docs/registry-security.md). The
[Verified Handoff specification](docs/verified-handoff.md) documents the
Receipt meaning and signature allowlist.

The sponsorship path has independent public-build and Worker release gates.
It is enabled for Base Mainnet and Base Sepolia. BaseStamp validates the
authenticated session, one-time grant, wallet/chain binding, Registry call, and
per-claim concurrency before proxying ERC-7677 requests to CDP. Eligibility,
contract/function rules, and spend limits are controlled by the CDP Paymaster
policy. A user must explicitly choose the wallet-paid path when sponsorship is
unavailable; BaseStamp does not silently submit a paid transaction.

## Current release

Milestones **3b (Mainnet Core MVP)** and the repository/production portion of
**3c (Base Builder publication)** are complete. The public app defaults to Base
Mainnet, and the same chain-selected create, confirmation, package, handoff, and
verification paths continue to support Base Sepolia.

Available:

- browser wallet and Sign in with Base authentication;
- Base Account authentication through the wallet_connect SIWE capability, with a manual SIWE fallback for injected wallets;
- Japanese and English UI catalogs with request/browser-language initialization and a persisted explicit selector;
- a shared handoff story on Home, Create, and Verify, with Create progress advancing from authentication to recording and sharing;
- wallet-connect and authentication prompts on Create that disappear as each prerequisite is completed;
- visible private handoff URL and copyable localized recipient instructions after recording;
- a clear-and-restart verification JSON control that returns to the JSON picker on the Verify entry page, plus detailed match results;
- automatic Base Sepolia/Base Mainnet wallet network switching;
- live connector-chain revalidation before every Registry write, with an explicit switch action when the wallet and selected network differ;
- local previews for common image, video, audio, PDF, and text formats;
- salted SHA-256 commitments calculated in a browser worker;
- wallet-confirmed Base Mainnet and Base Sepolia Registry transactions, with Base Account sponsorship and an explicit wallet-paid alternative;
- Turnstile-gated, wallet- and chain-bound sponsorship grants and a Worker Paymaster proxy with strict UserOperation validation, per-claim concurrency locking, and retention cleanup;
- real-D1 concurrency coverage proving that one claim admits only one active
  Paymaster RPC reservation while repeated ERC-7677 requests are not counted
  as separate transactions;
- automatic verification-package download;
- private fragment handoff URLs with explicit copy, Web Share, and local QR;
- local recipient comparison with no file or salt upload;
- one-time, wallet-bound EIP-712 acknowledgement challenges after a UI match;
- locally downloaded strict Handoff Receipt JSON with EOA, ERC-1271, and
  allowlisted Base Account ERC-6492 verification;
- classic sender-to-recipient JSON handoff;
- wallet-free recipient verification;
- strict package parsing and pinned Registry/RPC verification;
- public Japanese and English legal, privacy, terms, and security pages linked
  from every page footer;
- production ERC-8021 Builder Code attribution for direct and Base Account
  transactions;
- standard Web App metadata, branded icons, social image, and Base.dev submission material.

Intentionally not available:

- x402;
- server-side file or verification-package storage;
- a public Handoff Receipt timeline or searchable Receipt index;
- a public stamp directory.

## Base Sepolia Registry

The canonical testnet Registry is ownerless and has no admin, upgrade, asset, or
withdrawal surface.

- **Contract:** [`0x6491b8FBB13f7ADa916dD81B0834B529285f4EdB`](https://sepolia.basescan.org/address/0x6491b8FBB13f7ADa916dD81B0834B529285f4EdB)
- **Deployment transaction:** [`0x06e54d…809b`](https://sepolia.basescan.org/tx/0x06e54d004389016a27271d8ba8523067244962057137342cb5437fc8e967809b)
- **Deployment block:** `44999837`
- **Source verification:** Sourcify exact match and Blockscout verified

The canonical deployment record is stored in
[`contracts/deployments/84532.json`](contracts/deployments/84532.json).

## Base Mainnet Registry

The ownerless canonical Registry is deployed, source-verified, and enabled in
the public application.

- **Contract:** [`0x6491b8FBB13f7ADa916dD81B0834B529285f4EdB`](https://basescan.org/address/0x6491b8FBB13f7ADa916dD81B0834B529285f4EdB#code)
- **Deployment transaction:** [`0xa7078d…ae84`](https://basescan.org/tx/0xa7078def113cadf25d0930ff8889fbd2d96112a805281e9cf3be38f06744ae84)
- **Deployment block:** `49918391`
- **Source verification:** Basescan `Pass - Verified`

The canonical deployment record is stored in
[`contracts/deployments/8453.json`](contracts/deployments/8453.json).

The guarded deployment ceremony and browser-signer CORS recovery notes are
documented in [Registry security](docs/registry-security.md). The deployment
script refuses a second Mainnet deployment when this canonical manifest exists.

## Base Builder release

- **Standard Web App ID:** `6a709d282c28265d676171e1`
- **Builder Code:** `bc_o3k81ayl`
- **Primary URL:** [basestamp-web.ndun000.workers.dev](https://basestamp-web.ndun000.workers.dev/)
- **Category:** Developer tools
- **Mainnet direct transaction with ERC-8021 attribution:** [`0x709785…ef85`](https://basescan.org/tx/0x70978557cd70183acb30d70104f34ece9d3778a43e9a0c14fc258531e69bef85)
- **Mainnet sponsored Base Account transaction with embedded ERC-8021 attribution:** [`0x77e19a…d538`](https://basescan.org/tx/0x77e19acfb8136d10e09b93fce9da9d398fce6cd2740f2f48a1f2a43f32aed538)

The production Worker has also observed Mainnet Paymaster proxy claims
reach `sponsored`. Paymaster RPC calls used to assemble one wallet transaction
are concurrency-controlled but are not counted as transactions or as a
BaseStamp-specific quota.

The exact Base.dev copy, assets, URLs, release evidence, mobile checklist, and
operator-only Dashboard verification steps are kept in
[`docs/base-dashboard-submission.md`](docs/base-dashboard-submission.md).
Dashboard ownership/verification and analytics are external account state and
must be confirmed by the project owner in Base.dev; repository checks never
claim that state from an App ID alone.

## Local development

### Requirements

- Node.js 24
- pnpm 11
- Foundry 1.7

A pinned Dev Container is included for contributors who prefer an isolated,
reproducible toolchain.

### Start the app

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm env:init
pnpm d1:migrate:local
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173). The Worker health endpoint
is available at [http://localhost:5173/api/health](http://localhost:5173/api/health).

`pnpm env:init` creates ignored local configuration files without overwriting
existing files or printing the generated session secret.

### Run the full verification suite

```bash
pnpm run ci
```

This runs linting, TypeScript checks, Solidity formatting and linting, browser
and Worker tests, a migrated local-D1 sponsorship concurrency test, contract
tests, Registry artifact validation, the local D1 migration, and production
builds.

Individual commands are also available:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm contracts:test
pnpm build
```

## Repository layout

```text
apps/web/                  React UI and Cloudflare Worker API
apps/web/migrations/       D1 schema
contracts/src/             Solidity Registry
contracts/test/            Unit, fuzz, and invariant tests
contracts/deployments/     Canonical public deployment records
docs/                      Security and data-boundary documentation
scripts/                   Environment and artifact checks
```

## Configuration and secrets

The committed `apps/web/wrangler.jsonc` is the non-secret deployment
configuration and source of truth for Worker bindings. Resource identifiers such
as a D1 `database_id` are configuration, not credentials.

Never commit:

- `.env`, `.env.local`, or `.dev.vars`;
- Cloudflare API tokens;
- `SESSION_HASH_SECRET`;
- wallet private keys or keystores;
- CDP, Paymaster, or other provider credentials.

Use ignored local environment files for development and Cloudflare encrypted
secrets for deployed Workers. Public browser settings belong in `VITE_*`
variables and must never contain secret values.

BaseStamp does not create Turnstile or CDP resources through their APIs.
Mainnet and Sepolia sponsorship are enabled only after their operator-run
resource, secret, provider-policy, budget, and release gates have completed.
The browser-facing Paymaster proxy accepts CORS only from the exact Base
Account popup origins listed in `SPONSOR_ALLOWED_ORIGINS`; the current
production value is `https://keys.coinbase.com`. This is a non-secret
allowlist, not an authentication control: every request still requires a
short-lived grant and passes server-side grant, wallet/chain binding, and call
validation. Sponsorship eligibility and provider-side limits are set in CDP.

The `/security` page and `/.well-known/security.txt` use the repository's
enabled GitHub Private Vulnerability Reporting channel. Both
`SECURITY_CONTACT_URL` and `VITE_SECURITY_CONTACT_URL` are pinned to the same
reviewed advisory URL; neither value is secret. Keep the server and browser
values aligned, and re-check that the GitHub channel remains enabled before a
release.

The current Mainnet beta disclosures are available at [legal notice](https://basestamp-web.ndun000.workers.dev/about/legal),
[privacy](https://basestamp-web.ndun000.workers.dev/privacy),
[terms](https://basestamp-web.ndun000.workers.dev/terms), and
[security](https://basestamp-web.ndun000.workers.dev/security).

BaseStamp's custom Workers Logs contain only fixed application-error events and,
for HTTP failures, the method and a bounded route class. Scheduled rejections
are contained. Invocation logs and automatic traces are disabled; BaseStamp
does not add request values, full paths, IPs, signatures, tokens, or confidential
provider URLs to custom logs. Cloudflare can still process platform and edge
metadata under its own service boundary.

### Production Worker authentication

SIWE fails closed unless the deployed Worker has all of the following:

- an exact `SIWE_ALLOWED_DOMAIN` and `SIWE_ALLOWED_ORIGIN` in
  `apps/web/wrangler.jsonc`;
- one or more approved Base chain IDs in `SIWE_CHAIN_IDS`;
- a remote D1 migration;
- a `SESSION_HASH_SECRET` stored as a Cloudflare encrypted secret.

From `apps/web`, configure a randomly generated secret interactively, then
deploy. Never pass the secret on the command line or commit it.

```bash
pnpm exec wrangler d1 migrations apply DB --remote
pnpm exec wrangler secret put SESSION_HASH_SECRET
pnpm exec wrangler deploy
```

When moving to a custom domain, update both SIWE values to the exact new host
and HTTPS origin before deploying. Do not derive these authentication values
from request `Host` or `Origin` headers.

## Security notes

- Onchain records are public and cannot be deleted.
- Do not place personal information or confidential text in public metadata.
- Losing the verification JSON prevents local comparison because its salt
  cannot be reconstructed from the onchain record unless the private handoff
  link is still available.
- Anyone with a private handoff link can test candidate files against its public
  commitment; do not publish or forward it casually.
- Treat every imported verification package as untrusted input.
- BaseStamp is not a notary, identity provider, copyright registry, or legal
  service.
