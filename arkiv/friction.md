# Arkiv friction log

Real friction we hit, logged as it happened (SDK `@arkiv-network/sdk` 1.0.1, Rabdi testnet). Each item: what we tried → what we expected → what happened → how to reproduce → what would help.

## What we'd improve first
1. **A way to keep one record per thing.** A re-check of the same address or name has no upsert and no "latest per key" query. Our first publishes piled up duplicates (13 exposure rows for 9 keys), and the app had to dedupe them. We now look up the live entity and update and extend it in one batch (items 6 and 7).
2. **Docs that match the SDK you install.** The API reference documents functions that 1.0.1 doesn't export, and the error for a large `limit` suggests an offset API that we couldn't find (items 5 and 8).
3. **"Not equal" in queries** (item 9), and documented explorer and indexer URLs (item 10).

## 1. Public RPC briefly unreachable (5 Nov 2026, ~20:53 IST)
- **Tried:** `eth_blockNumber` / `eth_getBalance` on `https://rpc.rabdi.db-chain.testnet.arkiv.network`.
- **Expected:** a JSON-RPC reply.
- **Happened:** Cloudflare HTTP 522 (origin not reachable) for a few minutes, back by 20:58. The chain kept producing blocks (252,006 at 20:15 → 253,389 at 20:58), so only the RPC front end was down.
- **Reproduce:** transient; not reproducible now.
- **Would help:** a status page or a second public endpoint for hackathons. On our side, every Arkiv call now has retries and a timeout.

## 2. A batch create with the wrong field name fails with an unclear message (5 Nov, ~22:14 IST)
- **Tried:** `walletClient.executeBatch({ creates: [{ schema, attributes: {…}, expiration }] })`. The list was typed `any[]`, so TypeScript didn't catch it.
- **Expected:** an error naming the field.
- **Happened:** `TypeError: The create values must be an object keyed by column name`. The field is `values` (`CreateEntityParameters`); we found that in the `.d.ts`.
- **Reproduce:** pass `attributes` instead of `values` in one `creates` entry.
- **Would help:** name the field in the message ("expected `values: { column: value }`"), or accept `attributes` as an alias.

## 3. A checksummed address string isn't accepted for an `addr` column (5 Nov, ~22:15 IST)
- **Tried:** `values: { account: "0x555B…24dc" }` for an `addr().indexed()` column.
- **Expected:** a 20-byte hex string read as an address, the way `string → str` is inferred.
- **Happened:** `SchemaMismatchError: Column "account": a addr column, but the value is a str. Write addr(...) around the value.` The message is clear, but every address column needs the wrapper.
- **Would help:** coerce valid 20-byte hex when the schema says `addr`, or a typed `values` helper so it shows at compile time.

## 4. Docs request: say that keyless reads work
- `rabdi({ accessKey: "" })` prints a warning ("heavily rate limited"), but queries succeed. That's why our README query runs for judges with no key. We assumed a key was required; one line in the Rabdi docs would save others the search.

## 5. `limit` above 100 fails at runtime, and the error points to an API we couldn't find (6 Nov)
- **Tried:** `select(...).where(eq("arkiv.schema", "lifeboat.exposure.v1")).limit(101).fetch()` (our app first used `limit(200)`).
- **Expected:** up to 101 results, or a compile-time limit.
- **Happened:** `limit 101 exceeds the node maximum of 100. Page through the results with an offset instead.` `limit(100)` works. The SDK has no offset option we could find; the docs' [paginate](https://docs.arkiv.network/querying/paginate/) page uses keyset paging (`gt("$key", …)`) instead.
- **Reproduce:** any keyless select with `.limit(101)`.
- **Would help:** expose the cap as a constant or type, auto-page in `fetch()`, and make the error suggest keyset paging.

## 6. No upsert: re-checks pile up as duplicates (6 Nov)
- **Tried:** re-publishing a fresh reading for the same address and chain every day.
- **Expected:** a way to say "this replaces my live reading for key X".
- **Happened:** each re-check is a new entity with a new key. Harbour showed 13 exposure rows for 9 keys and 3 name rows for 2 names, and the example key in our Swarm doc changed with every refresh.
- **Fix on our side:** the publishers now query their own live entity first, then update and extend it in the same `executeBatch`, so keys stay stable.
- **Would help:** an upsert by a user-chosen unique attribute set, or a "latest per (attributes)" query.

## 7. `$createdAt` / `$updatedAt` can be read but not filtered or used to dedupe (6 Nov)
- **Tried:** keep only the newest reading per address with a query.
- **Happened:** these fields are "not queryable — returned by projections only". We dedupe in the browser instead.
- **Would help:** filter and sort on them, or a distinct-on.

## 8. The TypeScript API reference doesn't match 1.0.1 (6 Nov)
- **Tried:** the [API reference](https://docs.arkiv.network/typescript-sdk/api-reference/).
- **Expected:** what `npm i @arkiv-network/sdk` installs (1.0.1).
- **Happened:** it documents `ne`, `not`, `jsonToPayload` with `contentType`/`entity.toJson()`, `bytes32` and a `tiramisu` chain (built from a later source commit). 1.0.1 exports none of these and has `between`, `bytes`, `key`, `rabdi` and `localhost` instead. The `chains/variables/rabdi/` page returns 404, and [column-types](https://docs.arkiv.network/schemas/column-types/) also lists `ne`.
- **Would help:** versioned API docs, or a note on which version a page describes.

## 9. No way to write "not equal" (6 Nov)
- **Tried:** `status != str('exposed')` with the raw `query()` API.
- **Happened:** the parser rejects `!=` and suggests `NOT (attr = value)`. Both `NOT (status = str('exposed'))` and `NOT status = str('exposed')` then fail with `An internal error was received. query: store: NotImplemented`.
- **Reproduce:** `client.query("arkiv.schema = str('lifeboat.exposure.v1') AND NOT (status = str('exposed'))", { limit: 3 })` on Rabdi, keyless.
- **Would help:** implement `NOT`/`!=`, or make the parser stop suggesting it until it works.

## 10. Explorer and indexer URLs aren't documented (6 Nov)
- `https://indexer.rabdi.db-chain.testnet.arkiv.network` serves the explorer UI and a JSON API that browsers may call (`/api/entity/<key>`, `/api/transaction/<hash>`, with the full operation history). The explorer has `/entity/<key>`, `/tx/<hash>` and `/address/<addr>`. None of this is on the [Rabdi page](https://docs.arkiv.network/networks/rabdi/). We link every row in our app to the explorer, so we had to guess the patterns.
- **Would help:** list the URL patterns and the indexer API on the network page.

## 11. Smaller gaps that shaped our design
- Expiry emits no event, and there are no historical reads ([watch-events](https://docs.arkiv.network/querying/watch-events/)). The Monitor can't be told "this alert just expired".
- `withCount()` exists in the SDK but isn't mentioned on the paginate page.
- The `ExpiryExtended` event gives the owner, not who extended the entity, so "anyone can extend" can only be credited through the indexer's transaction API.
- The Hub's AI-tools page advertises MCP, while the [agent-skill](https://docs.arkiv.network/start-here/agent-skill/) page only covers skills, with no MCP URL.

## 12. The keyless read quota runs out silently for a browser app (6 Nov)
- **Tried:** the app's Harbour page with keyless reads (about 9 queries per load), while two of us were testing it.
- **Expected:** a clear error once the free budget is spent.
- **Happened:** HTTP 429 with a `Retry-After` of several minutes. viem's HTTP transport honours that header, so every query simply hung and the page sat on "Reading…". We now drop the header in a custom `fetchFn` so the read fails fast and the page says "the free public query quota is used up". We also answer repeated identical queries from memory for 90 s.
- **Reproduce:** run keyless `select(...).fetch()` calls in a loop from one IP until you get a 429.
- **Would help:** document the budget (units per query, per IP, reset window), return it in a header so apps can pace themselves, and say whether there's an access key that is safe to ship in a public web page. Every Vite/React app is tempted to put the key in a `VITE_` variable, which publishes it.
