// Reads the public Q-Day registry on Arkiv: the "Harbour" views and the leaf-ledger "signed twice" alert.
// Reads only, so no .env is needed (without ARKIV_ACCESS_KEY it uses the public, rate-limited Rabdi endpoint):
//   cd scripts && npx tsx src/arkiv-query.ts [--writer 0x..]
// or with .env loaded: pnpm --filter @lifeboat/scripts arkiv-query [--writer 0x..]
import { asc, desc, eq } from "@arkiv-network/sdk/query";
import { formatEther, getAddress, type Address } from "viem";
import { argValue } from "./lib/env.js";
import { Aboard, Exposure, Leaf, NameCheck, PUBLISHER, arkivPublic } from "./lib/arkiv.js";

const pub = arkivPublic();
const writer = getAddress(argValue("--writer") ?? PUBLISHER);
const block = await pub.getBlockNumber();
const left = (expiresAt: bigint) => `${((Number(expiresAt - block) * 2) / 3600).toFixed(1)} h left`; // 2 s blocks
const evid = (r: { swarmRef?: { value: string }; evidenceHash?: { value: string } }) =>
  r.swarmRef?.value ? `  swarm ${r.swarmRef.value.slice(0, 12)}…${r.evidenceHash?.value ? ` keccak ${r.evidenceHash.value.slice(0, 12)}…` : " (no evidenceHash)"}` : "";

console.log(`Arkiv Rabdi block ${block}; entries vouched by ${writer}\n`);

// 1. exposed addresses, most ETH at risk first
const exposed = await pub
  .select({ $key: true, $expiresAt: true, address: true, chainId: true, ethAtRisk: true, via: true, evidence: true, swarmRef: true, evidenceHash: true })
  .from(Exposure)
  .where(eq("status", "exposed"))
  .ownedBy(writer)
  .orderBy(desc("ethAtRisk"))
  .limit(20)
  .fetch();
console.log(`Exposed keys (${exposed.entities.length}):`);
for (const r of exposed.entities) console.log(`  ${r.address.value}  chain ${r.chainId.value}  ${r.ethAtRisk.value} ETH  via ${r.via.value}  (${left(r.$expiresAt)})${evid(r)}`);

// 2. who is aboard: verified moves to post-quantum accounts
const aboard = await pub.select({ $key: true, from: true, to: true, kind: true, chainId: true, txHash: true, swarmRef: true, evidenceHash: true }).from(Aboard).ownedBy(writer).limit(20).fetch();
console.log(`\nAboard (${aboard.entities.length}):`);
for (const r of aboard.entities) console.log(`  ${r.kind.value.padEnd(13)} ${r.from.value} -> ${r.to.value}  chain ${r.chainId.value}  tx ${r.txHash.value.slice(0, 12)}…${evid(r)}`);

// 3. ENS names and their Helm check verdicts
const names = await pub.select({ $key: true, name: true, verdict: true, owner: true, paths: true, checkedBlock: true, $expiresAt: true, swarmRef: true, evidenceHash: true }).from(NameCheck).ownedBy(writer).limit(20).fetch();
console.log(`\nNames (${names.entities.length}):`);
for (const r of names.entities) console.log(`  ${r.name.value}: ${r.verdict.value} (paths ${r.paths.value}) owner ${r.owner.value} at block ${r.checkedBlock.value} (${left(r.$expiresAt)}, key ${r.$key.slice(0, 10)}…)${evid(r)}`);

// 4. leaf ledger: every published use of a one-time leaf, from ANY writer (watchers can report sightings)
const leaves: any[] = [];
for (let offset = 0; ; offset += 100) {
  const page = await pub.select({ $key: true, $owner: true, root: true, leaf: true, account: true, digest: true, txHash: true }).from(Leaf).orderBy(asc("$key")).limit(100).offset(offset).fetch();
  leaves.push(...page.entities);
  if (page.entities.length + page.skipped < 100) break;
}
const byLeaf = new Map<string, { digests: Set<string>; rows: any[] }>();
for (const r of leaves) {
  const k = `${r.root.value}:${r.leaf.value}`;
  if (!byLeaf.has(k)) byLeaf.set(k, { digests: new Set(), rows: [] });
  byLeaf.get(k)!.digests.add(r.digest.value.toLowerCase());
  byLeaf.get(k)!.rows.push(r);
}
console.log(`\nLeaf ledger: ${leaves.length} uses of ${byLeaf.size} distinct leaves`);
for (const r of leaves) console.log(`  key ${r.root.value.slice(0, 10)}… leaf ${String(r.leaf.value).padStart(3)}  ${r.account.value}  ${r.txHash.value.slice(0, 20)}…  (reported by ${r.$owner.slice(0, 8)}…)`);
const twice = [...byLeaf.entries()].filter(([, v]) => v.digests.size > 1);
console.log(twice.length ? `\n🚨 SIGNED TWICE: ${twice.map(([k, v]) => `${k} (${v.digests.size} digests)`).join(", ")}: these keys can be forged` : "\n✅ no leaf has signed two different messages");

const bal = await pub.getBalance({ address: writer });
console.log(`\nwriter balance ${formatEther(bal)} tGLM`);
export type { Address };
