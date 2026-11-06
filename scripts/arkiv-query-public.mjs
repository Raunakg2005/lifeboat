// Runnable queries for the public Q-Day registry on Arkiv. No access key, no .env needed:
//   pnpm install && node scripts/arkiv-query-public.mjs
// 1. exposed keys vouched for by the Lifeboat publisher (24 h records, refreshed by its re-checks)
// 2. the leaf ledger from ANY writer, grouped by (root, leaf): one-time WOTS+C leaves that signed two different
//    digests ("signed twice") can be forged. Leaf entries live 180 days, so this query always has data.
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { and, asc, eq } from "@arkiv-network/sdk/query";
import { http } from "viem";

const WRITER = "0xBAc277e47dd7B95c04BB3517b76c1dd9151A054a"; // Lifeboat publisher
const arkiv = createPublicClient({ chain: rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" }), transport: http(undefined, { retryCount: 4 }) });
const attrs = (e) => Object.fromEntries(Object.entries(e.$attributes).map(([k, v]) => [k, v.value]));

// 1. exposed keys vouched for by the Lifeboat publisher
const { entities } = await arkiv
  .select({ $key: true, $expiresAt: true, $attributes: true })
  .where(and(eq("arkiv.schema", "lifeboat.exposure.v1"), eq("status", "exposed")))
  .ownedBy(WRITER)
  .limit(20)
  .fetch();

for (const e of entities) {
  const a = attrs(e);
  console.log(`${a.address}  chain ${a.chainId}  ${a.ethAtRisk} ETH at risk  via ${a.via}  (entity ${e.$key.slice(0, 10)}…, expires at block ${e.$expiresAt})`);
}
console.log(`${entities.length} exposed key(s)\n`);

// 2. leaf ledger: every reported use of a one-time leaf, any writer, grouped by (root, leaf)
const leaves = [];
for (let offset = 0; ; offset += 100) {
  const page = await arkiv
    .select({ $key: true, $owner: true, $expiresAt: true, $attributes: true })
    .where(eq("arkiv.schema", "lifeboat.leaf.v1"))
    .orderBy(asc("$key"))
    .limit(100)
    .offset(offset)
    .fetch();
  leaves.push(...page.entities);
  if (page.entities.length < 100) break;
}
const groups = new Map();
for (const e of leaves) {
  const a = attrs(e);
  const k = `${String(a.root).toLowerCase()}:${a.leaf}`;
  if (!groups.has(k)) groups.set(k, { root: a.root, leaf: a.leaf, account: a.account, chainId: a.chainId, digests: new Map() });
  const g = groups.get(k);
  const d = String(a.digest).toLowerCase();
  if (!g.digests.has(d)) g.digests.set(d, { tx: a.txHash, by: e.$owner, key: e.$key });
}
console.log(`Leaf ledger: ${leaves.length} reported use(s) of ${groups.size} distinct (root, leaf) pair(s)`);
let twice = 0;
for (const g of groups.values()) {
  const n = g.digests.size;
  console.log(`  root ${String(g.root).slice(0, 12)}… leaf ${String(g.leaf).padStart(3)}  account ${g.account}  chain ${g.chainId}: ${n} digest${n > 1 ? "s" : ""}${n > 1 ? "  🚨 signed twice" : ""}`);
  if (n > 1) {
    twice++;
    const shown = [...g.digests].slice(0, 4);
    for (const [d, s] of shown) console.log(`      digest ${d.slice(0, 18)}…  tx ${String(s.tx).slice(0, 20)}…  reported by ${s.by}  (entity ${s.key.slice(0, 10)}…)`);
    if (n > shown.length) console.log(`      … and ${n - shown.length} more digests`);
  }
}
console.log(twice ? `\n${twice} leaf/leaves signed twice: those keys can be forged` : "\nno leaf has signed two different digests");
