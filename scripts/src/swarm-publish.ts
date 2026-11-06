// Swarm bonus: evidence files on Swarm, each linked from the Arkiv entity it backs (`swarmRef`) and pinned to its
// exact bytes (`evidenceHash` = keccak256 of the file), so anyone can fetch the file and check it against the record.
//   1. use (or buy) a postage batch on our Bee light node (Sepolia testnet, running in Docker)
//   2. re-check every claim on chain FIRST; the Helm reports uploaded are the exact output of this run's checks
//   3. upload each file with /bzz (named, pinned, not deferred), read it back byte for byte
//   4. update the Arkiv entities in place (NameCheck for both names, the forgery Exposure) and attach the rescue and
//      ENS-handover bundles to Aboard records (readonly, so an evidence-carrying record is added once per tx)
// Usage: pnpm --filter @lifeboat/scripts swarm-publish [--dry-run] [--hours 72]
//   --dry-run  every read and check, the hashes of the exact bytes that would be uploaded, and the planned Arkiv
//              creates / updates / extensions; uploads nothing, buys nothing, writes nothing
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { addr, dec, u64 } from "@arkiv-network/sdk/schema";
import { getAddress, parseAbi, type Hex, type PublicClient } from "viem";
import { argValue, hasFlag, repoPath } from "./lib/env.js";
import { publicClient as devnetClient } from "./lib/devnet.js";
import { mainnetClient, sepoliaClient, sepoliaLogsClient } from "./lib/ens.js";
import { Aboard, CHECKER, EXPIRY, Exposure, NameCheck, arkivClient } from "./lib/arkiv.js";
import { liveEntities, planWrites, printPlan, printSent, sendPlan, type Write } from "./lib/publish.js";
import { BEE, SWARM_GATEWAY, bee, beeHealth, evidenceHash, findBatch, jsonBytes, uploadFile, type Stamp } from "./lib/swarm.js";
import { helmCheck } from "@lifeboat/core";

const dry = hasFlag("--dry-run") || hasFlag("--dry");
const DEPTH = 18;
const hours = Number(argValue("--hours") ?? "72");
const PENDING = "pending-upload";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ev = (p: string) => JSON.parse(readFileSync(repoPath(...p.split("/")), "utf8"));
// a failed check stops the real run before anything is uploaded or sent; a dry run notes it and carries on
const failed: string[] = [];
const verify = (claim: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "✅" : "❌"} ${claim}: ${detail}`);
  if (!ok) failed.push(claim);
  if (!ok && !dry) throw new Error(`refusing to publish: ${claim} did not verify`);
};
const receiptOk = async (c: PublicClient, hash: Hex) => (await c.getTransactionReceipt({ hash }).catch(() => null))?.status === "success";
const AUDIT = { readonly: true, permissionlessExtension: true };

// 1. postage batch
const health = await beeHealth();
if (!health) throw new Error(`Bee node not reachable at ${BEE()}`);
let batch: (Stamp & { txHash?: string }) | null = await findBatch(DEPTH);
if (batch) console.log(`postage batch ${batch.batchID}: depth ${batch.depth}, TTL ${(batch.batchTTL / 3600).toFixed(1)} h, usable (Bee ${health.version})`);
else if (dry) console.log(`no usable depth-${DEPTH} batch: the real run would buy one for ${hours} h`);
else {
  const wallet = await bee("/wallet");
  const chain = await bee("/chainstate");
  const blocks = BigInt(Math.ceil((hours * 3600) / 12)); // Sepolia: 12 s blocks
  const amount = BigInt(chain.currentPrice) * blocks;
  const cost = Number(amount * (1n << BigInt(DEPTH))) / 1e16;
  console.log(`buying a postage batch: depth ${DEPTH}, ${hours} h, amount ${amount} PLUR/chunk, ~${cost.toFixed(4)} sBZZ (node has ${Number(wallet.bzzBalance) / 1e16})`);
  const res = await bee(`/stamps/${amount}/${DEPTH}`, { method: "POST" });
  console.log(`batch ${res.batchID} (tx ${res.txHash}); waiting until it's usable…`);
  for (let i = 0; i < 90 && !batch; i++) {
    const s = await bee(`/stamps/${res.batchID}`).catch(() => null);
    if (s?.usable) batch = { ...s, batchTTL: Number(s.batchTTL), txHash: res.txHash };
    else await sleep(10_000);
  }
  if (!batch) throw new Error("batch not usable after 15 min");
}

// 2. re-check the claims on chain; every file below is either fixed evidence or produced by these checks
const sepolia = sepoliaClient() as unknown as PublicClient;
const devnet = devnetClient() as unknown as PublicClient;
const dep = ev("deployments/sepolia.json");
const files: { path: string; bytes: Uint8Array; fresh: boolean }[] = [];
const addFile = (path: string) => files.push({ path, bytes: new Uint8Array(readFileSync(repoPath(...path.split("/")))), fresh: false });
for (const f of ["evidence/ef/frame-demo-leaf2.json", "evidence/ef/rescue.json", "evidence/ef/paymaster-guards.json", "evidence/ef/forgery.json", "evidence/ens/handover.json", "evidence/arkiv/publish.json"])
  if (existsSync(repoPath(...f.split("/")))) addFile(f);

const reports: Record<string, { report: Awaited<ReturnType<typeof helmCheck>>; path: string }> = {};
for (const n of ["lifeboatpq.eth", "lifeboatdemo.eth"]) {
  const report = await helmCheck(sepolia, sepoliaLogsClient() as any, [mainnetClient() as any], n, { pqWallets: [dep.pqWallet] });
  const path = `evidence/ens/helm-${n}-${report.block}.json`;
  files.push({ path, bytes: jsonBytes(report), fresh: true });
  reports[n] = { report, path };
  console.log(`✅ re-checked ${n}: ${report.verdict} at Sepolia block ${report.block} (owner ${report.owner})`);
}

const forgery = ev("evidence/ef/forgery.json");
verify("forged frame tx landed on chain 1337", await receiptOk(devnet, forgery.receipt.transactionHash), `${forgery.receipt.transactionHash} (leaf ${forgery.leaf} reused)`);

// Aboard: the readonly records arkiv-publish wrote; re-verify what each one claims before adding its evidence
const arkiv = arkivClient();
const aboardLive = await liveEntities(arkiv.reader, Aboard, arkiv.owner, ["from", "to", "chainId", "kind", "scheme", "root", "txHash", "note", "swarmRef", "evidenceHash"]);
const aboardRecord = (txHash: string, kind: string) => aboardLive.find((e) => String(e.txHash?.value).toLowerCase() === txHash.toLowerCase() && e.kind?.value === kind);
const aboardClaims: { kind: string; file: string; record: any }[] = [];

const has = (p: string) => files.some((f) => f.path === p);
const rescue = has("evidence/ef/rescue.json") ? ev("evidence/ef/rescue.json") : null;
const rescueRec = rescue && aboardRecord(rescue.altStaked.hash, "rescue-sweep");
if (!rescue) console.log("no evidence/ef/rescue.json: the rescue Aboard record gets no evidence");
else if (!rescueRec) console.log(`no live Aboard record for the rescue tx ${rescue.altStaked.hash}: run arkiv-publish first`);
else {
  verify("rescue sweep landed", await receiptOk(devnet, rescue.altStaked.hash), `${rescue.altStaked.hash} on chain 1337`);
  const left = await devnet.readContract({ address: rescue.usdc, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [rescue.sender] }).catch(() => null);
  verify("the exposed wallet's tokens are gone", left === 0n, left === null ? `mUSDC ${rescue.usdc} not readable on chain 1337` : `${rescue.sender} holds ${left} mUSDC`);
  verify("Aboard record matches the rescue evidence", getAddress(rescueRec.from.value) === getAddress(rescue.sender), `from ${rescueRec.from.value}`);
  aboardClaims.push({ kind: "rescue-sweep", file: "evidence/ef/rescue.json", record: rescueRec });
}

const handover = has("evidence/ens/handover.json") ? ev("evidence/ens/handover.json") : null;
const handoverTx = handover?.steps.find((s: any) => s.what.startsWith("6.")).hash as Hex;
const handoverRec = handover && aboardRecord(handoverTx, "ens-handover");
if (!handover) console.log("no evidence/ens/handover.json: the ENS-handover Aboard record gets no evidence");
else if (!handoverRec) console.log(`no live Aboard record for the ENS handover tx ${handoverTx}: run arkiv-publish first`);
else {
  verify("ENS handover transfer landed", await receiptOk(sepolia, handoverTx), handoverTx);
  const r = reports[handover.name]?.report ?? (await helmCheck(sepolia, sepoliaLogsClient() as any, [mainnetClient() as any], handover.name, { pqWallets: [dep.pqWallet] }));
  verify(`${handover.name} is still owned by the PQ wallet`, r.owner === getAddress(handover.pqWallet) && getAddress(handoverRec.to.value) === getAddress(handover.pqWallet), `owner ${r.owner} at block ${r.block}`);
  aboardClaims.push({ kind: "ens-handover", file: "evidence/ens/handover.json", record: handoverRec });
}

const hashes = Object.fromEntries(files.map((f) => [f.path, evidenceHash(f.bytes)]));
console.log(`\n${dry ? "would upload" : "uploading"} ${files.length} files (pinned, swarm-deferred-upload: false):`);
for (const f of files) console.log(`  ${f.path}  ${f.bytes.length} bytes  keccak256 ${hashes[f.path]}${f.fresh ? "  (written by this run's check)" : ""}`);

// 3. upload (real run only), then the Arkiv writes that point at the uploads
const refs: Record<string, { reference: string; evidenceHash: Hex; bytes: number; local: string; gateway: string; gatewayOk: boolean }> = {};
if (!dry) {
  for (const f of files.filter((x) => x.fresh)) {
    mkdirSync(repoPath("evidence", "ens"), { recursive: true });
    writeFileSync(repoPath(...f.path.split("/")), f.bytes);
  }
  for (const f of files) {
    const up = await uploadFile(basename(f.path), f.bytes, "application/json", batch!.batchID);
    if (up.evidenceHash !== hashes[f.path]) throw new Error(`${f.path}: uploaded bytes changed`);
    refs[f.path] = { ...up, local: `${BEE()}/bzz/${up.reference}/`, gateway: `${SWARM_GATEWAY}/bzz/${up.reference}/`, gatewayOk: false };
    console.log(`uploaded ${f.path} -> ${up.reference} (read back OK)`);
  }
}
const link = (path: string) => ({ swarmRef: refs[path]?.reference ?? PENDING, evidenceHash: hashes[path]! });

const writes: Write[] = [];
for (const [n, { report: r, path }] of Object.entries(reports))
  writes.push({ schema: NameCheck, values: { name: n, chainId: u64(11155111n), verdict: r.verdict, owner: addr(r.owner), paths: r.hijackablePaths.join(",") || "-", checkedBlock: u64(r.block), ...link(path) }, expiration: EXPIRY.name() });
writes.push({
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
    ...link("evidence/ef/forgery.json"),
  },
  expiration: EXPIRY.exposure(),
});
for (const { file, record: e } of aboardClaims)
  writes.push({
    schema: Aboard,
    values: { from: addr(getAddress(e.from.value)), to: addr(getAddress(e.to.value)), chainId: u64(BigInt(e.chainId.value)), kind: String(e.kind.value), scheme: String(e.scheme.value), root: String(e.root.value), txHash: String(e.txHash.value), note: String(e.note.value), ...link(file) },
    expiration: EXPIRY.aboard(),
    flags: AUDIT,
  });

const plan = await planWrites(writes, arkiv.owner, arkiv.reader);
printPlan(plan, dry ? "DRY RUN: Arkiv plan" : "Arkiv plan");
if (plan.rows.some((r) => r.schema === Aboard.name && r.op === "create"))
  console.log("   note: Aboard records are readonly; the older record of the same tx (no evidence) stays until it expires");
if (dry) {
  if (failed.length) console.log(`\n❌ ${failed.length} check(s) failed: the real run would stop at "${failed[0]}" and upload or send nothing`);
  console.log(`\ndry run: nothing uploaded or sent (swarmRef "${PENDING}" is filled in by the real run)`);
  process.exit(0);
}
if (!arkiv.writer) throw new Error("DEV_PRIVATE_KEY is not set: run with --dry-run, or load .env");
const sent = await sendPlan(plan, arkiv.writer);
printSent(sent);

// public gateway: chunks need a moment to spread through the network
for (let round = 0; round < 12 && Object.values(refs).some((r) => !r.gatewayOk); round++) {
  for (const r of Object.values(refs)) {
    if (r.gatewayOk) continue;
    try {
      r.gatewayOk = (await fetch(r.gateway, { signal: AbortSignal.timeout(30_000) })).ok;
    } catch {}
  }
  if (Object.values(refs).some((r) => !r.gatewayOk)) await sleep(10_000);
}
console.log(`public gateway read: ${Object.values(refs).filter((r) => r.gatewayOk).length}/${files.length} files open at ${SWARM_GATEWAY}`);

const wallet = await bee("/wallet").catch(() => ({}) as any);
const previous = existsSync(repoPath("evidence", "swarm", "swarm.json")) ? ev("evidence/swarm/swarm.json") : null;
const batchTx = batch!.txHash ?? (previous?.postageBatch?.id === batch!.batchID ? previous.postageBatch.txHash : undefined);
const record = {
  bee: { api: BEE(), version: health.version, mode: "light", network: "Sepolia testnet (network 10)", wallet: wallet.walletAddress, chequebook: wallet.chequebookContractAddress },
  postageBatch: { id: batch!.batchID, depth: batch!.depth, ttlHours: batch!.batchTTL / 3600, txHash: batchTx, boughtBy: wallet.walletAddress },
  gateway: SWARM_GATEWAY,
  refs,
  arkiv: { txHash: sent.txHash, created: sent.created, updated: sent.updated, extended: sent.extended, unchanged: sent.unchanged, links: writes.map((w) => ({ schema: w.schema.name, swarmRef: w.values.swarmRef, evidenceHash: w.values.evidenceHash })) },
  at: new Date().toISOString(),
};
mkdirSync(repoPath("evidence", "swarm"), { recursive: true });
writeFileSync(repoPath("evidence", "swarm", "swarm.json"), JSON.stringify(record, null, 2));
console.log("saved evidence/swarm/swarm.json");
