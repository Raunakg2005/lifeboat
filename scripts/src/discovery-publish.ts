// Publishes the council deep-scan findings to the public Q-Day registry, at Safe level only (never individual
// signers). The publisher rule holds: every Safe is re-scanned live on mainnet first, and only what that scan
// shows is written. The full scan (every signer, truncated nowhere) goes to Swarm and is linked via swarmRef.
// Usage: pnpm --filter @lifeboat/scripts discovery-publish
import { mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, formatEther, http } from "viem";
import { mainnet } from "viem/chains";
import { addr, dec, u64 } from "@arkiv-network/sdk/schema";
import { COUNCILS, PUBLIC_RPC, TENDERLY_MAINNET, scanSafe } from "@lifeboat/core";
import { repoPath } from "./lib/env.js";
import { CHECKER, EXPIRY, Exposure, arkivWallet } from "./lib/arkiv.js";
import { gatewayOpens, uploadFile } from "./lib/swarm.js";

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
mkdirSync(repoPath("evidence", "discovery"), { recursive: true });
writeFileSync(repoPath("evidence", "discovery", "councils.json"), json);
const ref = await uploadFile("councils.json", new TextEncoder().encode(json));
console.log(`full scan on Swarm: ${ref} (public gateway ${(await gatewayOpens(ref)) ? "opens" : "not yet"})`);

const creates = results.map((r) => ({
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
  },
  expiration: EXPIRY.exposure(),
}));
const { client: arkiv } = arkivWallet();
const out = await arkiv.executeBatch({ creates: creates as any });
console.log(`Arkiv batch ${out.txHash}: ${out.createdEntities.length} Safe-level entities`);
writeFileSync(repoPath("evidence", "discovery", "arkiv-publish.json"), JSON.stringify({ txHash: out.txHash, entities: out.createdEntities, swarmRef: ref, at: new Date().toISOString() }, null, 2));
