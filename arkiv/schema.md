# Arkiv schema: the public Q-Day registry

**Six entity types**, defined with `@arkiv-network/sdk` 1.0.1 `defineSchema` in [`packages/core/src/arkiv.ts`](../packages/core/src/arkiv.ts). That file is shared by the publisher scripts and the web app. Each named schema tags its entities with an indexed `arkiv.schema` attribute, so queries never mix them up.

**Writer (publisher) wallet:** `0xBAc277e47dd7B95c04BB3517b76c1dd9151A054a` on Rabdi (chain 7794095). It writes only after re-checking each claim on the chain it describes ([`arkiv-publish.ts`](../scripts/src/arkiv-publish.ts), [`swarm-publish.ts`](../scripts/src/swarm-publish.ts), [`discovery-publish.ts`](../scripts/src/discovery-publish.ts), [`monitor.ts`](../scripts/src/monitor.ts)). The app reads exposure, aboard, name, watch and alert records **only from this owner** (`ownedBy`). The leaf ledger is open to any writer, and each row says who wrote it.

## Who can edit what
| Schema | Lifetime | Creation flags | Who can change it | On a re-check |
|---|---|---|---|---|
| exposure | 24 h | none | only the owner | **updated in place** (patch + extend in one batch): same key, new reading, 24 h more |
| name | 24 h | none | only the owner | **updated in place**, same as exposure |
| aboard | 180 days | `readonly`, `permissionlessExtension` | **nobody** (not even us); **anyone** can extend its lifetime | never changed; a move re-published with its evidence gets one more record, and the app shows one row per transaction |
| leaf | 180 days | `readonly`, `permissionlessExtension` | nobody; anyone can extend; **anyone can write a new sighting** | never changed; one record per (key, leaf, message) |
| watch | 30 days | none | only the owner | created by the Monitor |
| alert | 30 days | none | only the owner | created for each new risky state or change (deduplicated by the Monitor) |

The app reads the flags from each entity's `$creationFlags` and draws the "readonly · anyone can extend" stamp from that data, not from this table.

## `lifeboat.exposure.v1`: is this key already public?
| Column | Type | Indexed | Why | Queried by |
|---|---|---|---|---|
| `address` | addr | ✅ | look up one address | Check ([`CheckView.tsx`](../app/src/CheckView.tsx)), publishers (find the live record to update) |
| `chainId` | u64 | ✅ | one record per address per chain | publishers |
| `status` | str | ✅ | `exposed` / `not-seen` / `pq` / `contract`: the main Harbour filter | Harbour, the README query |
| `via` | str | ✅ | how exposure was found: `nonce`, `code`, `safe-signature`, `wots-leaf-reuse` | shown per row |
| `ethAtRisk` | dec | ✅ | sort by what's at stake | Harbour "most at risk" |
| `checkedBlock` | u64 | | the block the check is true for | |
| `evidence` | str | | short proof note (≤ 128 bytes) | |
| `checker` | str | | publisher version | |
| `swarmRef` | str, optional | | Swarm reference of the full evidence file | the evidence drawer |
| `evidenceHash` | str, optional | | keccak256 of that file's bytes; the app re-checks it after download | the evidence drawer |

## `lifeboat.aboard.v1`: a verified move to a post-quantum account
| Column | Type | Indexed | Why |
|---|---|---|---|
| `from` | addr | ✅ | the exposed key that left ("did this address move?" on Check) |
| `to` | addr | ✅ | the PQ account it moved to ("is this address aboard?" on Check) |
| `chainId` | u64 | ✅ | |
| `kind` | str | ✅ | `rescue-sweep`, `ens-handover`, `pq-account` |
| `scheme` | str | ✅ | e.g. `WOTS+C-keccak-w16-S560-h8` |
| `root` | str | | the PQ key commitment |
| `txHash` | str | | the transaction that did it (the app shows one row per tx) |
| `note` | str | | one line for humans |
| `swarmRef`, `evidenceHash` | str, optional | | the rescue or handover evidence file, and its hash |

## `lifeboat.leaf.v1`: the one-time-key ledger
| Column | Type | Indexed | Why |
|---|---|---|---|
| `root` | str | ✅ | which key |
| `leaf` | u64 | ✅ | which one-time leaf |
| `account` | addr | ✅ | the account that used it |
| `chainId` | u64 | ✅ | |
| `digest` | str | | what the leaf signed |
| `txHash` | str | | where, e.g. a tx hash, `fee bump #3 …`, or `dry-run: …` when a signature was only revealed to a node |

**Any wallet may write a sighting**, for example a watcher that sees a leaf in a mempool. Two entries for one `(root, leaf)` with different digests mean **the key signed twice and can be forged**. Harbour raises "signed twice" ([`HarbourView.tsx`](../app/src/HarbourView.tsx)), and so do [`arkiv-query.ts`](../scripts/src/arkiv-query.ts) and the keyless [`arkiv-query-public.mjs`](../scripts/arkiv-query-public.mjs). Harbour pages through the whole ledger by entity key (`orderBy(asc("$key"))` + `gt("$key", last)`), 100 at a time, so junk entries can't push a real "signed twice" out of view.

## `lifeboat.name.v1`: ENSv2 Helm check verdicts
| Column | Type | Indexed | Why |
|---|---|---|---|
| `name` | str | ✅ | look up one name (Check), one record per name per chain |
| `chainId` | u64 | ✅ | |
| `verdict` | str | ✅ | `hijackable` / `protected` / `unknown` |
| `owner` | addr | ✅ | |
| `paths` | str | | the owner-controllable paths with an exposed holder, e.g. `1,2,3,4` |
| `checkedBlock` | u64 | | |
| `swarmRef`, `evidenceHash` | str, optional | | the full Helm report (every role holder, both completeness proofs) and its hash |

## `lifeboat.watch.v1`: what the Monitor watches
| Column | Type | Indexed | Why |
|---|---|---|---|
| `target` | str | ✅ | an address (lowercase) or an ENS name |
| `kind` | str | ✅ | `safe` / `guard` / `name` |
| `chainId` | u64 | ✅ | |
| `label` | str | | for humans |

Read by Harbour → Monitor (the "targets watched" count, via the SDK's count API).

## `lifeboat.alert.v1`: a risky state or a change on a watched target
| Column | Type | Indexed | Why |
|---|---|---|---|
| `target`, `kind`, `chainId` | | ✅ | which target |
| `event` | str | ✅ | `threshold-reachable`, `keys-exposed`, `recovery-started`, `recovered`, `guard-removed`, `verdict-changed`, `leaves-low`, `evidence-at-risk` |
| `severity` | str | ✅ | `high` / `medium` / `info`: Harbour's severity chips filter on it **in the query** (`eq("severity", …)`) and count each with the count API |
| `detail` | str | | ≤ 128 bytes, for humans |
| `checkedBlock` | u64 | | |

## Limits we designed around
- `str` ≤ 128 bytes: hashes and short notes only; full reports go to Swarm (`swarmRef` + `evidenceHash`).
- ≤ 32 attributes per entity, ≤ 128 KiB per write; one `executeBatch` per publish (creates, patches and extensions together).
- A query returns at most 100 entities. Totals come from the count API, and the ledger pages by key.
- Expiry is counted in 2-second blocks; `ExpirationTime.fromHours/fromDays` handles it, and the app shows "expires in 18 h" from `$expiresAt`.

## Live batches (6 Nov 2026, the latest refresh at 17:02 IST)
A daily refresh writes **no new entities**: it updates the same records in place and extends them. That run: 6 updated and extended in the first batch (5 unchanged), 3 in the second, 4 in the third. The first run that day created the ledger entry for leaf 2 and the two aboard records with evidence.
- [`0x38dd5f56…4e60`](https://rabdi.explorer.arkiv.network/tx/0x38dd5f56b395fccf39fcdd652dc4563b7b85fd0cf29b6c75628a780725884e60): 6 exposure records updated in place and extended ([`evidence/arkiv/publish.json`](../evidence/arkiv/publish.json)).
- [`0x919d16d9…11e4`](https://rabdi.explorer.arkiv.network/tx/0x919d16d93694321b31dcc55862495806113e6549f44668b59d7ec358954e11e4): 2 names and the forgery exposure updated in place, with the fresh `swarmRef` + `evidenceHash` ([`evidence/swarm/swarm.json`](../evidence/swarm/swarm.json)).
- [`0x40e4baf4…1f63`](https://rabdi.explorer.arkiv.network/tx/0x40e4baf4d71e05fb765bf6807e7e56d378b191ebc0188134d34597d246cd1f63): 4 council Safe exposures updated ([`evidence/discovery/arkiv-publish.json`](../evidence/discovery/arkiv-publish.json)).
