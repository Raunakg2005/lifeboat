# Arkiv schema: the public Q-Day registry

Four entity types, defined with `@arkiv-network/sdk` 1.0.1 `defineSchema` in [`scripts/src/lib/arkiv.ts`](../scripts/src/lib/arkiv.ts). Each named schema tags its entities with an indexed `arkiv.schema` attribute, so queries never mix them up.

**Writer (publisher) wallet:** `0xBAc277e47dd7B95c04BB3517b76c1dd9151A054a` on Rabdi (chain 7794095). It writes only after re-checking each claim on the chain it describes ([`arkiv-publish.ts`](../scripts/src/arkiv-publish.ts)). "Vouched by" = `$owner`.

## `lifeboat.exposure.v1`: is this key already public?

| Column | Type | Indexed | Why |
|---|---|---|---|
| `address` | addr | ✅ | look up one address |
| `chainId` | u64 | ✅ | filter per chain |
| `status` | str | ✅ | `exposed` / `not-seen` / `pq` / `contract`: the main Harbour filter |
| `via` | str | ✅ | how exposure was found: `nonce`, `safe-signature`, `ens-control` (hidden exposure is our edge) |
| `ethAtRisk` | dec | ✅ | sort by what's at stake |
| `checkedBlock` | u64 | | the block the check is true for |
| `evidence` | str | | short proof note (≤ 128 bytes) |
| `checker` | str | | publisher version |
| `swarmRef` | str, optional | | Swarm reference of the full evidence bundle |

**Expiry: 24 hours.** Exposure only grows (a key that signs once stays exposed), but balances and status change, so an attestation is a *fresh* reading and the UI counts it down. Re-checking writes a new one.

## `lifeboat.aboard.v1`: a verified move to a post-quantum account

| Column | Type | Indexed | Why |
|---|---|---|---|
| `from` | addr | ✅ | the exposed key that left |
| `to` | addr | ✅ | the PQ account it moved to ("is this address aboard?") |
| `chainId` | u64 | ✅ | |
| `kind` | str | ✅ | `rescue-sweep`, `ens-handover`, `pq-account` |
| `scheme` | str | ✅ | e.g. `WOTS+C-keccak-w16-S560-h8` |
| `root` | str | | the PQ key commitment |
| `txHash` | str | | the transaction that did it |
| `note` | str | | one line for humans |
| `swarmRef` | str, optional | | |

**Expiry: 180 days, `readonly`, `permissionlessExtension`.** It's an audit trail: nobody, including us, can edit it, and anyone who relies on it can keep it alive.

## `lifeboat.leaf.v1`: the one-time-key ledger

| Column | Type | Indexed | Why |
|---|---|---|---|
| `root` | str | ✅ | which key |
| `leaf` | u64 | ✅ | which one-time leaf |
| `account` | addr | ✅ | the account that used it |
| `chainId` | u64 | ✅ | |
| `digest` | str | | what the leaf signed |
| `txHash` | str | | where (or `dry-run: …` when a signature was only revealed to a node) |

**Expiry: 180 days, `readonly`, `permissionlessExtension`.** **Any wallet may write a sighting**, e.g. a watcher that sees a leaf in a mempool. Two entries for one `(root, leaf)` with different digests means **the key signed twice and can be forged**: [`arkiv-query.ts`](../scripts/src/arkiv-query.ts) raises the alert.

## `lifeboat.name.v1`: ENSv2 Helm check verdicts

| Column | Type | Indexed | Why |
|---|---|---|---|
| `name` | str | ✅ | |
| `chainId` | u64 | ✅ | |
| `verdict` | str | ✅ | `hijackable` / `protected` / `unknown` |
| `owner` | addr | ✅ | |
| `paths` | str | | the owner-controllable paths with an exposed holder, e.g. `1,2,3,4` |
| `checkedBlock` | u64 | | |
| `swarmRef` | str, optional | | |

**Expiry: 24 hours** (roles change; the verdict must be fresh).

## Limits we designed around
- `str` ≤ 128 bytes: hashes and short notes only; full reports go to Swarm (`swarmRef`).
- ≤ 32 attributes per entity, ≤ 128 KiB per write; we write 12 entities in one `executeBatch`.
- Expiry is counted in 2-second blocks; the SDK's `ExpirationTime.fromHours/fromDays` handles it.

## Live entities (batch tx `0x54665e1faefbd2665f7a4d2634951dd061fcbec6bc2243ede449d38e327ed07f`)
3 × leaf, 2 × aboard, 1 × name, 6 × exposure. Keys: [`evidence/arkiv/publish.json`](../evidence/arkiv/publish.json).
