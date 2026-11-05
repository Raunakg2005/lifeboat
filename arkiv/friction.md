# Arkiv friction log

Real friction we hit, logged as it happened. Format: what we tried → what we expected → what happened → how to reproduce → suggestion.

## 1. Public RPC briefly unreachable (5 Nov 2026, ~20:53 IST)

- **Tried:** `eth_blockNumber` / `eth_getBalance` on `https://rpc.rabdi.db-chain.testnet.arkiv.network`.
- **Expected:** a JSON-RPC reply.
- **Happened:** Cloudflare HTTP 522 (origin not reachable) for a few minutes. It was back by 20:58. The chain kept producing blocks (252,006 at 20:15 → 253,389 at 20:58), so only the RPC front end was down.
- **Reproduce:** not reproducible now; it was transient.
- **Suggestion:** a status page or a second public RPC endpoint to fail over to during hackathons. On our side, every Arkiv call now has retries and a timeout.

## 2. A batch create with the wrong field name fails with an unclear message (5 Nov, ~22:14 IST)

- **Tried:** `walletClient.executeBatch({ creates: [{ schema, attributes: {…}, expiration }] })`. We built the list as `any[]`, so TypeScript didn't catch the field name.
- **Expected:** a validation error naming the missing field.
- **Happened:** `TypeError: The create values must be an object keyed by column name`. The field is `values` (`CreateEntityParameters`), but the message doesn't say so, so we had to read the `.d.ts` to find it.
- **Reproduce:** pass `attributes` instead of `values` in one `creates` entry.
- **Suggestion:** name the field in the message ("expected `values: { column: value }`"), or accept `attributes` as an alias.

## 3. A checksummed address string isn't accepted for an `addr` column (5 Nov, ~22:15 IST)

- **Tried:** `values: { account: "0x555B…24dc", … }` for an `addr().indexed()` column.
- **Expected:** a 0x-prefixed 20-byte hex string to be read as an address, the way `string → str` and `Uint8Array → bytes` are inferred.
- **Happened:** `SchemaMismatchError: Column "account": a addr column, but the value is a str. Write addr(...) around the value.` The message is clear and the fix is easy (`addr(x)`), but every address column needs the wrapper.
- **Suggestion:** when the schema says `addr` and the string is valid 20-byte hex, coerce it, or provide a typed `values` helper so this shows up at compile time.

## 4. Keyless reads work, which is good: noting it for others

- `rabdi({ accessKey: "" })` prints a warning ("heavily rate limited") but queries succeed, so our README's query runs for judges with no key. Worth stating in the docs: we assumed a key was required.
