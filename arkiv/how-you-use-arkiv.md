# How Lifeboat uses Arkiv: each feature and what the user sees

Try it: https://lifeboat-mu.vercel.app → **Harbour**, or **Check** any address or ENS name.

| Arkiv feature | Where | What the user sees |
|---|---|---|
| **Named schemas** (`defineSchema`, `arkiv.schema` tag) | 6 schemas in [`packages/core/src/arkiv.ts`](../packages/core/src/arkiv.ts), shared by app and scripts | Harbour's sections: exposed keys, aboard, names, Monitor, logbook |
| **Indexed attributes + `eq` filters** | `status`, `address`, `from`/`to`, `name`, `severity` | "Exposed keys"; Check's "is this address aboard?" and "is this name hijackable?"; Monitor's High / Medium / Info chips filter **in the query** |
| **`orderBy`** (`desc("ethAtRisk")`, `desc("$expiresAt")`, `asc("$key")`) | Harbour, Check, Monitor | "Most at risk" and "Newest" lists that really are in that order; a stable ledger order for paging |
| **Count API** (`count()`, `withCount()`) | every Harbour section, Check's registry board, the Monitor chips | true totals ("9 keys · 13 readings on Arkiv", "34 of 34 uses"), not a list cut off at 100 |
| **Keyset paging** (`gt("$key", last)`) | the logbook | "Load more": the whole one-time-key ledger is readable, so junk entries can't hide a real "signed twice" |
| **`ownedBy` + `$owner`** | Check and Harbour read exposure, aboard, name, watch and alert records **only from our publisher**; the open ledger shows its writer per row | nobody can plant a fake "moved to safety" record on Check; each sighting says "Lifeboat publisher" or "other writer 0x…" |
| **Expiry** (24 h / 30 d / 180 d) and `$expiresAt` | every record | "expires in 18 h" on each row; stale readings disappear by themselves, and the audit trail lasts 180 days |
| **Patch + extend in one `executeBatch`** | the publishers ([`lib/publish.ts`](../scripts/src/lib/publish.ts)) | a re-check updates the same record: one row per key, a link that keeps working, and a fresh 24 h |
| **`readonly` creation flag**, read back as `$creationFlags` | aboard + leaf | a "readonly · anyone can extend" stamp drawn from the chain data: an audit trail nobody can edit, including us |
| **`permissionlessExtension`** | aboard + leaf | anyone who relies on a record can keep it alive |
| **Anyone can write** | the leaf ledger | a mempool watcher can publish a sighting; **two digests for one leaf → "signed twice: this key can be forged"** |
| **Keyless public reads** | the app, [`arkiv-query-public.mjs`](../scripts/arkiv-query-public.mjs) | anyone can read the registry with no account and no key |
| **Explorer** (`/entity/<key>`, `/tx/<hash>`) | every row | "on Arkiv ↗": check any record and its batch yourself |
| **`swarmRef` + `evidenceHash` columns** | exposure, aboard, name | "open evidence": the app downloads the Swarm file, hashes it in the browser and shows "Swarm file matches the Arkiv record" ([swarm.md](swarm.md)) |

## Do the filters, editors and lifetimes fit the app?
- **Filters:** we index what someone actually asks:
  - "is *this address* exposed / aboard?" (`address`, `from`, `to`);
  - "is *this name* safe?" (`name`);
  - "show me the exposed ones, most at risk first" (`status`, `ethAtRisk`);
  - "which leaf of which key?" (`root`, `leaf`);
  - "only the high alerts" (`severity`).

  Fields that are only shown, never asked about (notes, evidence, block numbers), aren't indexed.
- **Editors:** a reading changes with the chain, so only its writer can update it. A move or a key use is history, so nobody can change it. The ledger must accept sightings from anyone, so it's open to writers and shows who wrote each row.
- **Lifetimes:**
  - A reading is true at a block, so 24 h, then re-check.
  - A watch or alert lasts as long as someone acts on it: 30 days.
  - The audit trail outlives the rescue: 180 days, and anyone can extend it.

## The publisher re-verifies before writing
[`arkiv-publish.ts`](../scripts/src/arkiv-publish.ts) refuses to publish anything it can't confirm on the chain it describes. In the 6 Nov run, 7 checks passed:
1. the PQ frame tx (leaf 2) landed on chain 1337;
2. the account's on-chain leaf floor moved past leaf 2;
3. the rescue sweep landed;
4. the exposed wallet's tokens are gone;
5. the Sepolia PQ wallet's WOTS-signed transaction landed;
6. that wallet marks leaf 0 used;
7. a fresh Helm check of `lifeboatpq.eth` says protected.

## Run it
```bash
pnpm --filter @lifeboat/scripts arkiv-publish --dry-run   # every check, then the planned creates / updates / extensions
pnpm --filter @lifeboat/scripts refresh                   # arkiv-publish, swarm-publish, discovery-publish
node scripts/arkiv-query-public.mjs                       # keyless: exposed keys + the "signed twice" check
```
