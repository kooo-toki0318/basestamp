# BaseStampRegistry security boundary

BaseStamp uses a deliberately ownerless and non-upgradeable canonical
registry. Its only state is the stamp mapping and the creator-scoped used-nonce
mapping. The deployed bytecode has no owner, admin, role, pause, upgrade,
payment, withdrawal, token-transfer, arbitrary-call, or minting function.

## Wallet roles

Keep these identities separate:

- The Builder identity wallet owns the Base.dev project and Builder Code. It
  should be a long-lived, hardware-protected identity and should not be an
  everyday asset wallet.
- Each network deployment uses a dedicated, least-funded signer. Production
  signers should be managed or hardware-backed and kept outside development
  environments.
- Sponsorship and relayer credentials are operational credentials
  and must be separate from both the Builder identity and deployers.

The Builder identity is not a contract owner. Builder attribution is added to
application transaction calldata, while the Registry deployment transaction is
sent by the deployment wallet. Because the Registry is ownerless, the deployer
retains no post-deployment authority.

## Authorization and replay boundary

Direct creation always sets the creator to `msg.sender`. Relayed creation is
permissionless, but the relay must provide an EIP-712 authorization signed by
the creator. The signature binds the creator, content commitment, metadata hash,
stamp nonce, deadline, chain ID, and deployed Registry address.

EOA and already-deployed ERC-1271 creators are supported through OpenZeppelin
`SignatureChecker`. Counterfactual ERC-6492 signatures are intentionally not
accepted by the onchain relay path.

Replay protection checks both the creator-scoped nonce and the derived stamp
ID. The ID is independent of timestamp, relayer, and transaction sender:

```text
keccak256(abi.encode(
  block.chainid,
  registry address,
  creator,
  content commitment,
  metadata hash,
  stamp nonce
))
```

## Asset boundary

The Registry rejects normal ETH transfers and has no asset movement function.
ETH forcibly sent by protocol behavior such as `SELFDESTRUCT`, or tokens sent
directly to the address, cannot be recovered by the Registry. The invariant is
therefore not that its balance is always zero; it is that ordinary transfers
are rejected and no Registry function can move a balance out.

## Release checklist

Before any Registry deployment:

1. Run `pnpm run ci` from the repository root.
2. Review the compiled ABI and confirm there are no owner, admin, payable,
   withdrawal, token-transfer, or arbitrary-call entries.
3. Confirm the RPC reports the intended chain ID: `84532` for Base Sepolia or
   `8453` for Base Mainnet.
4. Confirm the selected signer address matches the intended deployment wallet.
5. Fund only the deployment wallet with the minimum practical ETH.
6. Simulate the Foundry script before broadcasting.
7. Broadcast and verify source with the pinned compiler, EVM target, optimizer,
   runs, and OpenZeppelin version.
8. Record the deployment address, transaction hash, bytecode hash, and explorer
   verification URL in the public deployment manifest.
9. Run direct, signed-relay, `getStamp`, and `exists` smoke checks against
   the deployed address before enabling it in browser configuration.

### Additional Base Mainnet gate

For chain `8453`, use `pnpm contracts:deploy:mainnet` and its interactive
ceremony. It rejects raw private-key environment variables, an RPC on another
chain, an unfunded or zero deployer, non-interactive confirmation, and any
existing Mainnet deployment or broadcast record. It also rebuilds the artifact,
compares the immutable-normalized runtime with the reviewed canonical Sepolia
runtime, simulates before broadcasting, and requires source verification.

After broadcast, review the transaction and explorer verification, compare the
deployed runtime, create `contracts/deployments/8453.json`, and commit that
manifest before configuring the application. Keep Mainnet writes and
sponsorship disabled until the manifest, smoke checks, wallet-paid path,
Builder attribution, external-provider policy, budgets, and kill switches have
all passed their separate release gates.

With Foundry 1.7.1's browser signer, open the exact bridge origin
`http://127.0.0.1:9545`; `http://localhost:9545` is outside the bridge CORS
allowlist. Switch the wallet to Base Mainnet before connecting. If a browser
connection times out after a successful simulation, preserve the dry-run
evidence and inspect the chain-specific broadcast directory. Resume only with
the script's explicit `BASESTAMP_RESUME_DRY_RUN=true` path; it rebuilds,
re-simulates, and rejects any actual broadcast record or unexpected entry.

The current release has completed these gates: the canonical manifest is
committed, source and runtime are verified, all client paths are selected by
chain, Mainnet is the default public network, wallet-paid and sponsored records
have confirmed onchain, and representative direct and Base Account transaction
calldata contain the configured ERC-8021 Builder Code. Provider budgets and
eligibility remain operator-controlled external policy.

A source-verified deployment is not an audit or security guarantee.
