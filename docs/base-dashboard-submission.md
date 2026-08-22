# Base.dev submission and release record

This is the canonical operator worksheet for BaseStamp's standard Web App
listing. It separates verifiable public release evidence from Base.dev account
state that only the project owner can confirm.

## Listing copy

| Field | Value |
| --- | --- |
| App name | BaseStamp |
| Tagline | Verify the exact file later. |
| Category | Developer tools |
| Primary URL | https://basestamp-web.ndun000.workers.dev/ |
| Source | https://github.com/kooo-toki0318/basestamp |
| Standard Web App ID | `6a709d282c28265d676171e1` |
| Builder Code | `bc_o3k81ayl` |
| Builder address | `0x9571E605452c075776831d032F7415E6323e66B9` |
| Mainnet Registry | `0x6491b8FBB13f7ADa916dD81B0834B529285f4EdB` |

Short description:

> Record a private, salted file commitment on Base and give the recipient a
> local way to verify the exact file later. BaseStamp never uploads the original
> file and supports wallet-free verification.

Long description:

> BaseStamp helps creators and teams hand off files with a reproducible
> integrity check. Before sending a file, the browser calculates a salted
> commitment locally and writes only the minimum public record to an ownerless
> Registry on Base. The sender keeps a portable verification JSON and can share
> a private fragment link. A recipient can compare the received file locally
> without connecting a wallet. Optional wallet-signed Handoff Receipts record a
> limited statement about that local observation; they are not notarization,
> identity verification, or legal proof.

Features:

- Base Mainnet recording with Base Sepolia retained for testing;
- Base Account and browser-wallet connection with SIWE authentication;
- conditional ERC-7677 gas sponsorship through a private backend proxy;
- explicit wallet-paid fallback with no silent paid submission;
- ERC-8021 Builder Code attribution;
- browser-worker hashing with no file-upload endpoint;
- private fragment handoff links, local QR/Web Share, and portable JSON;
- wallet-free local verification and optional signed Handoff Receipts;
- Japanese and English interfaces;
- public source, data boundaries, terms, privacy, and security reporting.

## Assets

Use only the committed production assets:

| Purpose | Repository file | Public URL |
| --- | --- | --- |
| Square icon | `apps/web/public/basestamp-icon-512.png` | https://basestamp-web.ndun000.workers.dev/basestamp-icon-512.png |
| SVG icon | `apps/web/public/basestamp-icon.svg` | https://basestamp-web.ndun000.workers.dev/basestamp-icon.svg |
| Social / hero image | `apps/web/public/basestamp-social.png` | https://basestamp-web.ndun000.workers.dev/basestamp-social.png |
| Home screenshot | `docs/assets/base-dashboard/home-mainnet.png` | Upload from the repository |
| Create screenshot | `docs/assets/base-dashboard/create-mainnet.png` | Upload from the repository |
| Verify screenshot | `docs/assets/base-dashboard/verify.png` | Upload from the repository |

Screenshots must show production UI without a connected wallet, personal
address, private handoff fragment, file name, Turnstile token, or transaction
draft. Regenerate them after a material visual change.

## Public release evidence

Checked on 2026-08-22:

- production URL returns the standard Web App document with
  `base:app_id=6a709d282c28265d676171e1`;
- Base Mainnet is the default UI network and chain `8453` is enabled through
  the reviewed deployment manifest and production build gate;
- the ownerless Mainnet Registry is source-verified on Basescan;
- at least five `StampCreated` events were present in the reviewed recent
  Mainnet block range;
- the production D1 aggregate contained three Mainnet claims in
  `sponsored` state;
- direct Mainnet transaction
  `0x70978557cd70183acb30d70104f34ece9d3778a43e9a0c14fc258531e69bef85`
  contains the configured ERC-8021 suffix exactly once;
- sponsored Base Account transaction
  `0x77e19acfb8136d10e09b93fce9da9d398fce6cd2740f2f48a1f2a43f32aed538`
  embeds the same suffix exactly once in its UserOperation calldata;
- the decoded suffix contains `bc_o3k81ayl` and the ERC-8021 marker;
- `/api/health/retention` was healthy and
  `/.well-known/security.txt` returned the reviewed private-reporting contact.

These checks prove the public code, onchain calls, and BaseStamp proxy state.
They do not prove that Base.dev has indexed a transaction or that an account
badge is currently displayed.

## Base.dev owner checklist

Base.dev is authenticated external state. The project owner must perform and
record these checks in the Dashboard; do not infer them from the public App ID.

- [ ] Project shows the exact primary URL above.
- [ ] Ownership / App Verification shows **Verified** for the builder address.
- [ ] Name, icon, tagline, description, category, and all three screenshots
      match this document.
- [ ] Builder Code is exactly `bc_o3k81ayl`.
- [ ] The Onchain / Total Transactions view attributes the direct transaction.
- [ ] The Onchain / Total Transactions view attributes the sponsored Base
      Account transaction or its UserOperation.
- [ ] The production URL opens inside the Base App on a real phone.
- [ ] Inside the Base App: connect, SIWE, create, automatic confirmation,
      package download/share, and verify all complete on Base Mainnet.
- [ ] Outside the Base App: the same flow completes in a mobile browser.
- [ ] No private link fragment, file bytes/name, salt, session token, or
      Turnstile token appears in Dashboard material or screenshots.

Record the check date and Dashboard reviewer in the private validation log.
Do not commit authenticated Dashboard screenshots or account exports unless
they are deliberately redacted and reviewed for personal data.

## Mobile smoke matrix

| Surface | Required result |
| --- | --- |
| Base App in-app browser | Header controls fit; Base Account connects; SIWE succeeds; Mainnet remains selected |
| iOS Safari | Home, Create, Verify, legal pages, file picker, share sheet, and downloads remain usable |
| Android Chrome | Same flow; wallet handoff returns to the pending confirmation state |
| Narrow viewport (320 px) | No horizontal page overflow; transaction hash and URLs wrap inside their cards |
| Reduced motion | Progress remains understandable without animation |
| Keyboard / screen reader | File controls have labels; status changes use live regions; focus is visible |

## Current Base opportunities

Availability was reviewed against Base documentation on 2026-08-22. Base.dev
currently describes App verification as the entry point for rewards and partner
opportunities, and Base documentation lists Builder Rewards and retroactive
Builder Grants. These programs are external, discretionary, and can change.
Confirm current eligibility in Base.dev immediately before applying. Do not
promise rewards to users, generate meaningless transactions, or perform Sybil
activity.

## External submission boundary

Repository changes and deployments may prepare the listing, but clicking a
Base.dev verification, publication, rewards, grant, or ecosystem-submission
action is an authenticated external action. The project owner performs that
action and is responsible for confirming that submitted information is
accurate and current.
