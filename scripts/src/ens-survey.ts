// A fair, unstaged survey of real ENSv2 names on Sepolia: who could steer them on Q-Day?
//
// Sample: every .eth name ever registered in ENSv2 (the ETHRegistry's LabelRegistered events), active ones only,
// ONE per owner (their newest), so a bulk registrant doesn't dominate, and none registered by or for our own
// test wallets. Each gets the full Helm check (5 control paths, role lists proven complete).
//
// Names belong to people, so only aggregates and label hashes are written: never a name or an address.
// Usage: pnpm --filter @lifeboat/scripts ens-survey [--limit 60] [--retry-errors]
//   --retry-errors: re-check only the names that errored last time (rate limits) and merge them in.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Address } from "viem";
import { PUBLISHER, helmCheck, registeredNames, type HelmReport } from "@lifeboat/core";
import { argValue, repoPath } from "./lib/env.js";
import { mainnetClient, sepoliaClient, sepoliaLogsClient } from "./lib/ens.js";

const LIMIT = Number(argValue("--limit") ?? 60);
const state = existsSync(repoPath("deployments", "sepolia.json")) ? JSON.parse(readFileSync(repoPath("deployments", "sepolia.json"), "utf8")) : {};
const ours = [PUBLISHER, state.pqWallet, state.delegate, state.operator].filter(Boolean) as string[];

const pub = sepoliaClient() as any;
const logs = sepoliaLogsClient() as any;
const main = mainnetClient() as any;

const t0 = Date.now();
const all = await registeredNames(pub, logs, { exclude: ours });
const byRegistrant = new Map<string, (typeof all)[number]>(); // keyed by owner: LabelRegistered's sender is the registrar contract
for (const n of all) if (!byRegistrant.has(n.owner)) byRegistrant.set(n.owner, n); // newest first
const RETRY = process.argv.includes("--retry-errors");
const prevPath = repoPath("evidence", "ens", "survey.json");
const prev = RETRY && existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, "utf8")) : null;
const retryHashes = new Set<string>((prev?.results ?? []).filter((r: { verdict: string }) => r.verdict === "error").map((r: { labelHash: string }) => r.labelHash));
const fullSample = [...byRegistrant.values()].slice(0, prev ? prev.sampled : LIMIT);
const sample = prev ? fullSample.filter((n) => retryHashes.has(n.labelHash)) : fullSample;
console.log(`${all.length} active names by ${byRegistrant.size} owners (ours excluded); checking ${sample.length}, one per owner`);

type Row = { labelHash: string; verdict: HelmReport["verdict"] | "error"; paths: number[]; ownerExposure?: string; resolverExposed?: boolean; holders?: number };
const rows: Row[] = [];
let block = 0n;
const queue = [...sample];
await Promise.all(
  Array.from({ length: 3 }, async () => {
    for (let n = queue.shift(); n; n = queue.shift()) {
      try {
        const r = await helmCheck(pub, logs, [main], n.name, { pqWallets: [state.pqWallet].filter(Boolean) as Address[] });
        if (r.block > block) block = r.block;
        rows.push({
          labelHash: n.labelHash,
          verdict: r.verdict,
          paths: r.hijackablePaths,
          ownerExposure: r.entries.find((e) => e.path === 1)?.holder.exposure,
          resolverExposed: r.entries.some((e) => e.path === 4 && e.holder.exposure === "exposed"),
          holders: new Set(r.entries.filter((e) => e.path <= 4).map((e) => e.holder.address)).size,
        });
      } catch (e) {
        rows.push({ labelHash: n.labelHash, verdict: "error", paths: [] });
        console.log(`  one name could not be checked: ${String((e as Error).message).split("\n")[0]!.slice(0, 120)}`);
      }
      process.stdout.write(`\r  ${rows.length}/${sample.length}`);
    }
  }),
);
process.stdout.write("\n");

const allRows: Row[] = prev ? [...prev.results.filter((r: Row) => !(r.verdict === "error" && rows.some((n) => n.labelHash === r.labelHash))), ...rows] : rows;
if (prev && BigInt(prev.block) > block) block = BigInt(prev.block);
const count = (f: (r: Row) => boolean) => allRows.filter(f).length;
const checked = allRows.filter((r) => r.verdict !== "error");
const summary = {
  chain: "sepolia",
  registry: "ENSv2 ETHRegistry (.eth)",
  block: block.toString(),
  checkedAt: new Date().toISOString(),
  method: "One active name per owner (their newest), all ENSv2 .eth registrations, our own test wallets excluded. Full Helm check on each: 5 control paths, role lists proven complete. Hijackable = an owner-controllable path (1-4) held by a key whose public key is on-chain.",
  activeNames: all.length,
  owners: byRegistrant.size,
  sampled: fullSample.length,
  checked: checked.length,
  verdicts: { hijackable: count((r) => r.verdict === "hijackable"), protected: count((r) => r.verdict === "protected"), unknown: count((r) => r.verdict === "unknown"), error: count((r) => r.verdict === "error") },
  paths: Object.fromEntries([1, 2, 3, 4].map((p) => [p, count((r) => r.paths.includes(p))])),
  ownerKinds: { exposed: count((r) => r.ownerExposure === "exposed"), notSeen: count((r) => r.ownerExposure === "not-seen"), contract: count((r) => r.ownerExposure === "contract"), pq: count((r) => r.ownerExposure === "pq-wallet") },
  note: "A name owned by a contract (a Safe, a wrapper) isn't counted as safe: who controls it depends on that contract.",
  resolverExposed: count((r) => !!r.resolverExposed),
  results: allRows,
};
mkdirSync(repoPath("evidence", "ens"), { recursive: true });
writeFileSync(repoPath("evidence", "ens", "survey.json"), JSON.stringify(summary, null, 2));
console.log(
  `block ${summary.block}: ${summary.verdicts.hijackable} of ${summary.checked} hijackable on Q-Day, ${summary.verdicts.protected} with no exposed key on paths 1-4 (of which ${summary.ownerKinds.contract} owned by contracts), ${summary.verdicts.unknown} unknown, ${summary.verdicts.error} errors · paths ${JSON.stringify(summary.paths)} · ${((Date.now() - t0) / 1000).toFixed(0)} s`,
);
console.log("wrote evidence/ens/survey.json (aggregates and label hashes only)");
