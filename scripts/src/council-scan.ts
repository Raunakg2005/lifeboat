// CLI: hidden exposure of public security-council Safes (Ethereum mainnet).
// Usage: pnpm --filter @lifeboat/scripts council-scan [--save]
import { mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { COUNCILS, PUBLIC_RPC, TENDERLY_MAINNET, scanSafe } from "@lifeboat/core";
import { hasFlag, repoPath } from "./lib/env.js";

const client = createPublicClient({ chain: mainnet, transport: http(PUBLIC_RPC.mainnet, { retryCount: 3, timeout: 30_000, batch: { batchSize: 50 } }) });
const logs = createPublicClient({ chain: mainnet, transport: http(TENDERLY_MAINNET, { retryCount: 3, timeout: 60_000 }) });
const results = [];
for (const c of COUNCILS) {
  const t0 = Date.now();
  const r = await scanSafe(client as any, logs as any, c.safe, { label: c.label, maxExecutions: 80, onStep: (s) => console.log(`  ${c.label}: ${s}`) });
  results.push(r);
  console.log(
    `${c.label}: ${r.threshold}-of-${r.owners.length} · exposed by nonce ${r.exposedByNonce} → with signatures ${r.exposedTotal} · takeable: ${r.takeableByNonce ? "yes" : "no"} → ${r.takeableWithSignatures ? "YES" : "no"} · ${r.executionsDecoded}/${r.executionsSeen} executions decoded · ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
}
if (hasFlag("--save")) {
  mkdirSync(repoPath("evidence", "discovery"), { recursive: true });
  const p = repoPath("evidence", "discovery", "councils.json");
  writeFileSync(p, JSON.stringify({ chain: "ethereum", scannedAt: new Date().toISOString(), results }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  console.log(`saved ${p}`);
}
