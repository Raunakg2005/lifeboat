# How Lifeboat uses Arkiv: each feature and what the user sees

| Arkiv feature | Where | What the user sees |
|---|---|---|
| **Named schemas** (`defineSchema`, `arkiv.schema` tag) | 4 schemas in [`lib/arkiv.ts`](../scripts/src/lib/arkiv.ts) | Separate Harbour tabs: exposed keys, aboard, names, leaf ledger |
| **Indexed attributes + `eq`/`desc` queries** | `status`, `ethAtRisk`, `verdict`, `root`, `leaf` | "Exposed keys, most ETH at risk first"; "is this name hijackable?"; every use of a leaf |
| **`ownedBy` + `$owner`** | every Harbour query | a "vouched by 0xBAc2…" badge; you can choose whose attestations you trust |
| **Expiry** (`ExpirationTime.fromHours(24)` / `fromDays(180)`) | exposure + name: 24 h; aboard + leaf: 180 d | "valid for 23.6 h" countdown, then "re-check"; stale verdicts disappear by themselves |
| **`readonly` creation flag** | aboard + leaf | an audit trail nobody can edit, including us |
| **`permissionlessExtension`** | aboard + leaf | anyone who relies on a record can keep it alive |
| **`executeBatch`** | the publisher | one transaction per scan (12 entities in `0x54665e1f…d07f`, 0.0032 tGLM) |
| **Anyone can write** | leaf ledger | a mempool watcher can publish a sighting; **two digests for one leaf = "🚨 signed twice: this key can be forged"** |
| **Keyless public reads** | README query | judges and wallets can query without an account or key |

## The publisher re-verifies before writing
[`arkiv-publish.ts`](../scripts/src/arkiv-publish.ts) refuses to publish anything it can't confirm on the chain it describes. In the first publish, 7 checks passed:
1. the PQ frame tx landed on chain 1337;
2. the account's on-chain leaf floor moved past leaf 1;
3. the rescue sweep landed;
4. the exposed wallet's tokens are gone;
5. the Sepolia PQ wallet's WOTS-signed transaction landed;
6. it marks leaf 0 used;
7. a fresh Helm check of `lifeboatpq.eth` says protected.

## Run it
```bash
pnpm --filter @lifeboat/scripts arkiv-publish --dry   # show what would be published, with every check
pnpm --filter @lifeboat/scripts arkiv-publish
pnpm --filter @lifeboat/scripts arkiv-query
```
