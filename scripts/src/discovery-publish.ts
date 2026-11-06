// Publishes the council deep-scan findings to the public Q-Day registry, at Safe level only (never individual
// signers). The publisher rule holds: every Safe is re-scanned live on mainnet first, and only what that scan
// shows is written. The full scan (every signer, truncated nowhere) goes to Swarm: the exact bytes of this run's
// councils.json, linked via swarmRef and pinned by evidenceHash (keccak256). Each Safe's live Exposure record is
// updated in place (stable key, expiry extended); see lib/publish.ts.
// Usage: pnpm --filter @lifeboat/scripts discovery-publish [--dry-run]
//   --dry-run  scan, hash the file that would be uploaded, print the planned Arkiv writes; uploads and writes nothing
import { mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, formatEther, http } from "viem";
import { mainnet } from "viem/chains";
import { addr, dec, u64 } from "@arkiv-network/sdk/schema";
import { COUNCILS, PUBLIC_RPC, TENDERLY_MAINNET, scanSafe } from "@lifeboat/core";
import { hasFlag, repoPath } from "./lib/env.js";
import { CHECKER, EXPIRY, Exposure, arkivClient } from "./lib/arkiv.js";
import { planWrites, printPlan, printSent, sendPlan, type Write } from "./lib/publish.js";
import { evidenceHash, gatewayOpens, uploadFile } from "./lib/swarm.js";

const dry = hasFlag("--dry-run") || hasFlag("--dry");
const client = createPublicClient({ chain: mainnet, transport: http(PUBLIC_RPC.mainnet, { retryCount: 3, timeout: 30_000, batch: { batchSize: 50 } }) });
const logs = createPublicClient({ chain: mainnet, transport: http(TENDERLY_MAINNET, { retryCount: 3, timeout: 60_000 }) });

const results = [];
for (const c of COUNCILS) {
  const r = await scanSafe(client as any, logs as any, c.safe, { label: c.label, maxExecutions: 80 });
  const balance = await client.getBalance({ address: c.safe });
  results.push({ ...r, balance });
  console.log(`${c.label}: ${r.threshold}-of-${r.owners.length}, nonce ${r.exposedByNonce} -> signatures ${r.exposedTotal}, takeable ${r.takeableWithSignatures} (block ${r.block})`);
}
const json = JSON.stringify({ chain: "ethereum", scannedAt: new Date().toISOString(), results }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
const bytes = new TextEncoder().encode(json);
const hash = evidenceHash(bytes);
console.log(`\ncouncils.json: ${bytes.length} bytes, keccak256 ${hash}${dry ? " (would be written and uploaded)" : ""}`);

let ref = "pending-upload";
if (!dry) {
  mkdirSync(repoPath("evidence", "discovery"), { recursive: true });
  writeFileSync(repoPath("evidence", "discovery", "councils.json"), bytes);
  const up = await uploadFile("councils.json", bytes);
  if (up.evidenceHash !== hash) throw new Error("councils.json: uploaded bytes changed");
  ref = up.reference;
  console.log(`full scan on Swarm: ${ref} (pinned, read back OK)`);
}

const writes: Write[] = results.map((r) => ({
  schema: Exposure,
  values: {
    address: addr(r.safe),
    chainId: u64(1n),
    status: r.takeableWithSignatures ? "exposed" : "not-seen",
    via: "safe-signature",
    ethAtRisk: dec(formatEther(r.balance)),
    checkedBlock: u64(r.block),
    evidence: `${r.label}: ${r.exposedTotal}/${r.owners.length} signer keys public (${r.exposedByNonce} by nonce), threshold ${r.threshold}`.slice(0, 128),
    checker: CHECKER,
    swarmRef: ref,
    evidenceHash: hash,
  },
  expiration: EXPIRY.exposure(),
}));
const arkiv = arkivClient();
const plan = await planWrites(writes, arkiv.owner, arkiv.reader);
printPlan(plan, dry ? "DRY RUN: Arkiv plan" : "Arkiv plan");
if (dry) {
  console.log(`\ndry run: nothing uploaded or sent (swarmRef "pending-upload" is filled in by the real run)`);
  process.exit(0);
}
if (!arkiv.writer) throw new Error("DEV_PRIVATE_KEY is not set: run with --dry-run, or load .env");
const sent = await sendPlan(plan, arkiv.writer);
printSent(sent);
console.log(`public gateway: ${(await gatewayOpens(ref)) ? "opens" : "not yet"}`);
writeFileSync(
  repoPath("evidence", "discovery", "arkiv-publish.json"),
  JSON.stringify({ txHash: sent.txHash, created: sent.created, updated: sent.updated, extended: sent.extended, swarmRef: ref, evidenceHash: hash, at: new Date().toISOString() }, null, 2),
);
