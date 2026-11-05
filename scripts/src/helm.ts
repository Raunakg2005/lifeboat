// CLI: pnpm --filter @lifeboat/scripts helm <name.eth> [--save]
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import type { Address } from "viem";
import { hasFlag, repoPath } from "./lib/env.js";
import { mainnetClient, sepoliaClient, sepoliaLogsClient } from "./lib/ens.js";
import { helmCheck, printReport } from "./lib/helm.js";

const name = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "lifeboatpq.eth";
const dep = repoPath("deployments", "sepolia.json");
const pqWallets: Address[] = existsSync(dep) ? [JSON.parse(readFileSync(dep, "utf8")).pqWallet].filter(Boolean) : [];

const report = await helmCheck(sepoliaClient() as any, sepoliaLogsClient() as any, [mainnetClient() as any], name, { pqWallets });
printReport(report);
if (hasFlag("--save")) {
  mkdirSync(repoPath("evidence", "ens"), { recursive: true });
  const path = repoPath("evidence", "ens", `helm-${name}-${report.block}.json`);
  writeFileSync(path, JSON.stringify(report, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  console.log(`saved ${path}`);
}
