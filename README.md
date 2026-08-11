# BaseStamp

Private file records and independent verification on Base.

BaseStamp lets you record that a specific file existed without uploading the
file itself. It creates a salted commitment locally in your browser, stores the
minimum public record on Base, and gives you a portable JSON package that
another person can use to verify the file later.

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

Send the recipient all three of these:

- the original file;
- the BaseStamp verification JSON;
- a link to the BaseStamp Verify page.

The file and JSON can be delivered through email, cloud storage, chat, or any
other channel you already use.

### Verify a received file

1. Open `/verify`.
2. Select the received BaseStamp JSON.
3. Select the candidate original file.
4. BaseStamp checks the approved Registry record and compares the file locally.

Verification does not require a wallet.

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
- browser session storage is only a navigation convenience, not permanent
  package storage.

Read the detailed [data boundaries](docs/data-boundaries.md),
[authentication threat model](docs/threat-model.md), and
[Registry security boundary](docs/registry-security.md).

## Current release

The current release targets **Base Sepolia**.

Available:

- browser wallet and Sign in with Base authentication;
- Base Account authentication through the wallet_connect SIWE capability, with a manual SIWE fallback for injected wallets;
- Japanese and English UI catalogs with request/browser-language initialization and a persisted explicit selector;
- a shared handoff story on Home, Create, and Verify with each page role highlighted;
- explicit wallet-connect and authentication prerequisites on Create;
- visible verification URL and copyable localized recipient instructions after recording;
- clear/replace verification JSON controls and detailed match results;
- automatic Base Sepolia/Base Mainnet wallet network switching;
- local previews for common image, video, audio, PDF, and text formats;
- salted SHA-256 commitments calculated in a browser worker;
- user-paid Base Sepolia Registry transactions;
- automatic verification-package download;
- sender-to-recipient JSON handoff;
- wallet-free recipient verification;
- strict package parsing and pinned Registry/RPC verification.

Not available yet:

- Base Mainnet recording;
- sponsored transactions;
- x402;
- server-side file or verification-package storage;
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

This runs linting, TypeScript checks, Solidity formatting and linting, web and
contract tests, Registry artifact validation, the local D1 migration, and
production builds.

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
  cannot be reconstructed from the onchain record.
- Treat every imported verification package as untrusted input.
- BaseStamp is not a notary, identity provider, copyright registry, or legal
  service.

