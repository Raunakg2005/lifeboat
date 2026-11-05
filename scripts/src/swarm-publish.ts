// Swarm bonus: evidence bundles on Swarm, referenced from Arkiv entities (field `swarmRef`).
//   1. use (or buy) a postage batch on our Bee light node (Sepolia testnet, running in Docker)
//   2. upload each evidence bundle with /bzz (a named file, so links open in a browser)
//   3. read every reference back through the local node and the public testnet gateway
//   4. publish Arkiv entities whose `swarmRef` points at the bundle
// Usage: pnpm --filter @lifeboat/scripts swarm-publish [--hours 72]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { dec, u64, addr } from "@arkiv-network/sdk/schema";
import { getAddress } from "viem";
import { argValue, repoPath } from "./lib/env.js";
import { mainnetClient, sepoliaClient, sepoliaLogsClient } from "./lib/ens.js";
import { CHECKER, EXPIRY, Exposure, NameCheck, arkivWallet } from "./lib/arkiv.js";
import { helmCheck } from "@lifeboat/core";

const BEE = process.env.BEE_API_URL || "http://127.0.0.1:1633";
const GATEWAY = "https://api.gateway.testnet.ethswarm.org";
const DEPTH = 18;
const hours = Number(argValue("--hours") ?? "72");

async function bee(path: string, init?: RequestInit) {
  const r = await fetch(BEE + path, { ...init, signal: AbortSignal.timeout(120_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Bee ${init?.method ?? "GET"} ${path}: HTTP ${r.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 1. postage batch
const wallet = await bee("/wallet");
const chain = await bee("/chainstate");
let stamps: any[] = (await bee("/stamps")).stamps ?? [];
let batch = stamps.find((s) => s.usable && s.depth >= DEPTH && Number(s.batchTTL) > 3600);
if (!batch) {
  const blocks = BigInt(Math.ceil((hours * 3600) / 12)); // Sepolia: 12 s blocks
  const amount = BigInt(chain.currentPrice) * blocks;
  const cost = Number(amount * (1n << BigInt(DEPTH))) / 1e16;
  console.log(`buying a postage batch: depth ${DEPTH}, ${hours} h, amount ${amount} PLUR/chunk, ~${cost.toFixed(4)} sBZZ (node has ${Number(wallet.bzzBalance) / 1e16})`);
  const res = await bee(`/stamps/${amount}/${DEPTH}`, { method: "POST" });
  console.log(`batch ${res.batchID} (tx ${res.txHash}); waiting until it's usable…`);
  for (let i = 0; i < 90; i++) {
    const s = await bee(`/stamps/${res.batchID}`).catch(() => null);
    if (s?.usable) {
      batch = s;
      break;
    }
    await sleep(10_000);
  }
  if (!batch) throw new Error("batch not usable after 15 min");
  batch.txHash = res.txHash;
}
console.log(`postage batch ${batch.batchID}: depth ${batch.depth}, TTL ${(Number(batch.batchTTL) / 3600).toFixed(1)} h, usable`);

// 2. upload bundles
const files = [
  "evidence/ef/frame-demo-leaf1.json",
  "evidence/ef/rescue.json",
  "evidence/ef/paymaster-guards.json",
  "evidence/ef/forgery.json",
  "evidence/ens/handover.json",
  "evidence/arkiv/publish.json",
];
// the latest Helm reports for both demo names
const { readdirSync } = await import("node:fs");
for (const n of ["lifeboatpq.eth", "lifeboatdemo.eth"]) {
  const latest = readdirSync(repoPath("evidence", "ens"))
    .filter((f) => new RegExp(`^helm-${n.replace(".", "\\.")}-\\d+\\.json$`).test(f))
    .sort()
    .pop();
  if (latest) files.push(`evidence/ens/${latest}`);
}
const refs: Record<string, { reference: string; local: string; gateway: string; gatewayOk: boolean }> = {};
for (const f of files) {
  const body = readFileSync(repoPath(...f.split("/")));
  const res = await bee(`/bzz?name=${encodeURIComponent(basename(f))}`, { method: "POST", headers: { "content-type": "application/json", "swarm-postage-batch-id": batch.batchID }, body });
  const reference = res.reference as string;
  // 3. read back locally (must match byte for byte)
  const back = await fetch(`${BEE}/bzz/${reference}/`).then((r) => r.arrayBuffer());
  if (Buffer.compare(Buffer.from(back), body) !== 0) throw new Error(`${f}: local read-back differs`);
  refs[f] = { reference, local: `${BEE}/bzz/${reference}/`, gateway: `${GATEWAY}/bzz/${reference}/`, gatewayOk: false };
  console.log(`uploaded ${f} -> ${reference} (${body.length} bytes, read back OK)`);
}

// public gateway: chunks need a moment to spread through the network
for (let round = 0; round < 12 && Object.values(refs).some((r) => !r.gatewayOk); round++) {
  for (const r of Object.values(refs)) {
    if (r.gatewayOk) continue;
    try {
      const res = await fetch(r.gateway, { signal: AbortSignal.timeout(30_000) });
      r.gatewayOk = res.ok;
    } catch {}
  }
  if (Object.values(refs).some((r) => !r.gatewayOk)) await sleep(10_000);
}
console.log(`public gateway read: ${Object.values(refs).filter((r) => r.gatewayOk).length}/${files.length} bundles open at ${GATEWAY}`);

// 4. Arkiv entities pointing at the bundles (field `swarmRef`)
const sepolia = sepoliaClient() as any;
const dep = JSON.parse(readFileSync(repoPath("deployments", "sepolia.json"), "utf8"));
const creates: any[] = [];
for (const n of ["lifeboatpq.eth", "lifeboatdemo.eth"]) {
  const r = await helmCheck(sepolia, sepoliaLogsClient() as any, [mainnetClient() as any], n, { pqWallets: [dep.pqWallet] });
  const file = Object.keys(refs).find((f) => f.includes(`helm-${n}-`))!;
  creates.push({
    schema: NameCheck,
    values: { name: n, chainId: u64(11155111n), verdict: r.verdict, owner: addr(r.owner), paths: r.hijackablePaths.join(",") || "-", checkedBlock: u64(r.block), swarmRef: refs[file]!.reference },
    expiration: EXPIRY.name(),
  });
  console.log(`re-checked ${n}: ${r.verdict}`);
}
const forgery = JSON.parse(readFileSync(repoPath("evidence", "ef", "forgery.json"), "utf8"));
creates.push({
  schema: Exposure,
  values: {
    address: addr(getAddress(forgery.naiveAccount)),
    chainId: u64(1337n),
    status: "exposed",
    via: "wots-leaf-reuse",
    ethAtRisk: dec(forgery.after.account),
    checkedBlock: u64(BigInt(parseInt(forgery.receipt.blockNumber, 16))),
    evidence: `leaf ${forgery.leaf} signed ${forgery.bumps.length + 1}+ messages; forged in ${forgery.forge.tries} tries`,
    checker: CHECKER,
    swarmRef: refs["evidence/ef/forgery.json"]!.reference,
  },
  expiration: EXPIRY.exposure(),
});
const { client } = arkivWallet();
const out = await client.executeBatch({ creates });
console.log(`Arkiv batch ${out.txHash}: ${out.createdEntities.length} entities with swarmRef`);

const record = {
  bee: { api: BEE, version: (await bee("/health")).version, mode: "light", network: "Sepolia testnet (network 10)", wallet: wallet.walletAddress, chequebook: wallet.chequebookContractAddress },
  postageBatch: { id: batch.batchID, depth: batch.depth, ttlHours: Number(batch.batchTTL) / 3600, txHash: batch.txHash, boughtBy: wallet.walletAddress },
  gateway: GATEWAY,
  refs,
  arkiv: { txHash: out.txHash, entities: out.createdEntities.map((k, i) => ({ key: k, schema: i < 2 ? "lifeboat.name.v1" : "lifeboat.exposure.v1", swarmRef: creates[i].values.swarmRef })) },
  at: new Date().toISOString(),
};
mkdirSync(repoPath("evidence", "swarm"), { recursive: true });
writeFileSync(repoPath("evidence", "swarm", "swarm.json"), JSON.stringify(record, null, 2));
console.log("saved evidence/swarm/swarm.json");
