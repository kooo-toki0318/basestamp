# Verified Handoff

Verified Handoff is BaseStamp's private sender-to-recipient path:

```text
/handoff/{stampId}#k={base64url(contentSalt)}
```

The fragment is not part of an HTTP request. BaseStamp captures the canonical
32-byte key before React starts, removes it from the address bar, and keeps it
only in browser memory. The browser reads the fixed Base Sepolia Registry and
recalculates the file commitment in a dedicated worker. A mismatch never
renders the Receipt-signing action.

## Optional Receipt

After a local match, an authenticated Base Sepolia wallet can request a
ten-minute, one-time EIP-712 challenge. The Worker binds it to the session
wallet, chain, stamp, current Registry commitment, and fixed statement:

> I verified in my browser that the selected file matches the content
> commitment associated with this BaseStamp record.

The Worker validates the signature and atomically consumes the challenge. The
browser then creates and downloads a strict `BaseStampHandoffReceipt` JSON.
The Receipt contains no content salt and is not stored in a public timeline.

The Receipt means only that the named wallet signed the statement about its
browser-local observation. Because the Worker never receives the file or
comparison key, the Receipt does not independently prove:

- which bytes the signer selected;
- the file match itself;
- the signer's real identity or authority;
- legal receipt, inspection, approval, or acceptance.

`verifiedAt` and the verification block are unsigned observation fields. A
contract-wallet signature can have different validity later, so BaseStamp
rechecks imported Receipts at the recorded block and does not claim perpetual
validity.

## Signature policy

EOA and deployed ERC-1271 signatures are verified at a fixed block. ERC-6492
counterfactual signatures are accepted only for the pinned Base Account
deployment below:

| Component | Address | Runtime code hash |
| --- | --- | --- |
| Factory | `0xba5ed110efdba3d005bfc882d75358acbbb85842` | `0xb60a629aa7c6af9b550871fd21b67ab84638156683cec68491049cb5d235ed2f` |
| Implementation | `0x00000110dCdEdC9581cb5eCB8467282f2926534d` | `0x136185896fc519277ec953c0b3d048fc0c9f607b8d04022e60f23ef8dbc6c4d5` |
| Validator | `0xcfCE48B757601F3f351CB6f434CB0517aEEE293D` | `0x94a000eab18fdda0465241bd0e82487463fb2e539854a3645542e57ed8dde484` |

BaseStamp decodes only the factory's `createAccount(bytes[],uint256)` call,
checks `implementation()`, derives the expected signer with `getAddress`,
checks all three code hashes at the verification block, and then uses read-only
signature simulation. It does not execute an arbitrary counterfactual factory.

## Imported Receipt validation

Receipt input is limited to 64 KiB and rejects unknown fields, duplicate keys,
prototype keys, noncanonical numbers, unsupported versions, and altered
EIP-712 domain or type definitions. Revalidation uses the fixed Base Sepolia
RPC and Registry; the Receipt's URL is never fetched.
