// Lifeboat Monitor: re-checks every watched target and raises alerts.
//   * first sight: risky states (a Safe whose threshold of signer keys is already public, a Quantum Guard that was
//     recovered or has a recovery pending, a name that can be steered on Q-Day)
//   * later passes: changes (more keys exposed, a recovery started, the guard removed, a verdict changed)
// An alert is raised once per state (deduplicated in scripts/.monitor-state.json).
// Alerts go to Arkiv (public, 30 days, lifeboat.alert.v1), to stdout, and to an optional webhook
// (MONITOR_WEBHOOK_URL in .env: Discord or Slack style; it stays private). Mainnet is only ever read.
// Usage: pnpm --filter @lifeboat/scripts monitor [--every 600] [--no-arkiv]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, getAddress, type Address, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { u64 } from "@arkiv-network/sdk/schema";
import { eq } from "@arkiv-network/sdk/query";
import { GUARD_SLOT, RPCS, helmCheck, quantumGuardAbi, rpcTransport, scanSafe, slotAddress } from "@lifeboat/core";
import { argValue, hasFlag, repoPath } from "./lib/env.js";
import { Alert, EXPIRY, PUBLISHER, Watch, arkivPublic, arkivWallet } from "./lib/arkiv.js";
import { sepoliaClient, sepoliaLogsClient } from "./lib/ens.js";

type Target = { kind: "safe" | "guard" | "name"; chainId: number; target: string; label: string };
type Raised = { target: string; kind: string; chainId: number; event: string; severity: "high" | "medium" | "info"; detail: string; block: bigint };

const config = JSON.parse(readFileSync(repoPath("scripts", "monitor.targets.json"), "utf8")) as { targets: Target[] };
const statePath = repoPath("scripts", ".monitor-state.json");
const state: { seen: Record<string, any>; alerted: string[] } = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { seen: {}, alerted: [] };
const saveState = () => writeFileSync(statePath, JSON.stringify(state, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
const sepoliaState = JSON.parse(readFileSync(repoPath("deployments", "sepolia.json"), "utf8"));

const main = createPublicClient({ chain: mainnet, transport: rpcTransport(RPCS.mainnet, { batch: { batchSize: 50 } }) }) as PublicClient;
const mainLogs = createPublicClient({ chain: mainnet, transport: rpcTransport(RPCS.mainnetLogs, { timeout: 60_000 }) }) as PublicClient;
const sep = sepoliaClient() as unknown as PublicClient;
const sepLogs = sepoliaLogsClient() as unknown as PublicClient;
const webhook = process.env.MONITOR_WEBHOOK_URL?.trim();

async function check(t: Target): Promise<Raised[]> {
  const key = `${t.chainId}:${t.target.toLowerCase()}`;
  const prev = state.seen[key];
  const out: Raised[] = [];
  const raise = (event: string, severity: Raised["severity"], detail: string, block: bigint) => out.push({ target: t.target, kind: t.kind, chainId: t.chainId, event, severity, detail: detail.slice(0, 128), block });

  if (t.kind === "safe") {
    const r = await scanSafe(t.chainId === 1 ? main : sep, t.chainId === 1 ? mainLogs : sepLogs, getAddress(t.target), { label: t.label, maxExecutions: 80 });
    const now = { exposed: r.exposedTotal, owners: r.owners.length, threshold: r.threshold, takeable: r.takeableWithSignatures };
    if (r.takeableWithSignatures && (!prev || !prev.takeable)) raise("threshold-reachable", "high", `${t.label}: ${r.exposedTotal}/${r.owners.length} signer keys public, threshold ${r.threshold}`, r.block);
    else if (prev && r.exposedTotal > prev.exposed) raise("keys-exposed", "medium", `${t.label}: ${prev.exposed} -> ${r.exposedTotal} signer keys public (threshold ${r.threshold})`, r.block);
    state.seen[key] = now;
  }

  if (t.kind === "guard") {
    const block = await sep.getBlockNumber();
    const safe = getAddress(t.target);
    const guard = slotAddress(await sep.getStorageAt({ address: safe, slot: GUARD_SLOT, blockNumber: block }));
    const now: Record<string, any> = { guard, recovered: false, readyAt: "0", used: 0 };
    if (BigInt(guard) === 0n) {
      raise(prev?.guard && BigInt(prev.guard) !== 0n ? "guard-removed" : "no-guard", "high", `${t.label}: no transaction guard: owners' ECDSA keys alone control it`, block);
    } else {
      const r = (fn: string) => sep.readContract({ address: guard, abi: quantumGuardAbi, functionName: fn as any, blockNumber: block });
      const used = ((await r("usedLeaves")) as bigint).toString(2).split("").filter((b) => b === "1").length;
      const [readyAt, recovered] = (await Promise.all([r("recoveryReadyAt"), r("recovered")]).catch(() => [0n, false])) as [bigint, boolean];
      Object.assign(now, { recovered, readyAt: readyAt.toString(), used });
      if (prev?.guard && prev.guard !== guard) raise("guard-changed", "high", `${t.label}: guard changed ${prev.guard.slice(0, 10)} -> ${guard.slice(0, 10)}`, block);
      if (recovered && !prev?.recovered) raise("recovered", "high", `${t.label}: recovery completed, the guard no longer requires the PQ key`, block);
      if (readyAt > 0n && readyAt.toString() !== prev?.readyAt)
        raise("recovery-started", "high", `${t.label}: recovery pending until ${new Date(Number(readyAt) * 1000).toISOString()}: veto with the PQ key if it isn't you`, block);
      if (used >= 200 && (prev?.used ?? 0) < 200) raise("leaves-low", "medium", `${t.label}: ${used}/256 one-time leaves used: rotate the PQ key soon`, block);
    }
    state.seen[key] = now;
  }

  if (t.kind === "name") {
    const r = await helmCheck(sep, sepLogs, [main], t.target, { pqWallets: [sepoliaState.pqWallet].filter(Boolean) as Address[] });
    if (prev && prev.verdict !== r.verdict) raise("verdict-changed", r.verdict === "hijackable" ? "high" : "medium", `${t.target}: ${prev.verdict} -> ${r.verdict}${r.hijackablePaths.length ? ` (paths ${r.hijackablePaths.join(",")})` : ""}`, r.block);
    else if (!prev && r.verdict === "hijackable") raise("hijackable", "high", `${t.target}: can be steered on Q-Day through paths ${r.hijackablePaths.join(",")}`, r.block);
    state.seen[key] = { verdict: r.verdict, paths: r.hijackablePaths };
  }
  return out;
}

async function pass() {
  const raised: Raised[] = [];
  for (const t of config.targets) {
    try {
      const a = await check(t);
      raised.push(...a);
      console.log(`${t.label}: ${a.length ? a.map((x) => `${x.severity.toUpperCase()} ${x.event}`).join(", ") : "no change"}`);
    } catch (e) {
      console.log(`${t.label}: check failed (${String((e as Error).message).split("\n")[0]!.slice(0, 100)}); will retry next pass`);
    }
  }
  const fresh = raised.filter((r) => !state.alerted.includes(`${r.target.toLowerCase()}:${r.event}:${r.detail}`));
  for (const r of fresh) state.alerted.push(`${r.target.toLowerCase()}:${r.event}:${r.detail}`);
  saveState();
  if (!fresh.length) return console.log("no new alerts");

  if (webhook) {
    const text = fresh.map((r) => `${r.severity === "high" ? "🔴" : r.severity === "medium" ? "🟠" : "🔵"} ${r.detail}`).join("\n");
    await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text, text }) }).catch((e) => console.log(`webhook failed: ${e.message}`));
  }
  if (!hasFlag("--no-arkiv")) {
    const { client } = arkivWallet();
    // make sure every target has a public watch entry, then write the alerts in one batch
    const watched = await arkivPublic().select({ $key: true, target: true }).from(Watch).ownedBy(PUBLISHER).limit(100).fetch().catch(() => ({ entities: [] as any[] }));
    const have = new Set(watched.entities.map((e: any) => String(e.target.value).toLowerCase()));
    const watches = config.targets
      .filter((t) => !have.has(t.target.toLowerCase()))
      .map((t) => ({ schema: Watch, values: { target: t.target.toLowerCase(), kind: t.kind, chainId: u64(BigInt(t.chainId)), label: t.label.slice(0, 128) }, expiration: EXPIRY.watch() }));
    const alerts = fresh.map((r) => ({
      schema: Alert,
      values: { target: r.target.toLowerCase(), kind: r.kind, chainId: u64(BigInt(r.chainId)), event: r.event, severity: r.severity, detail: r.detail, checkedBlock: u64(r.block) },
      expiration: EXPIRY.alert(),
    }));
    const res = await client.executeBatch({ creates: [...watches, ...alerts] as any });
    console.log(`Arkiv batch ${res.txHash}: ${watches.length} watch entries, ${alerts.length} alerts`);
    writeFileSync(repoPath("evidence", "monitor", "last-pass.json"), JSON.stringify({ at: new Date().toISOString(), arkivTx: res.txHash, alerts: fresh }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  }
  void eq;
}

const every = Number(argValue("--every") ?? 0);
for (;;) {
  console.log(`\n— monitor pass ${new Date().toISOString()} —`);
  await pass();
  if (!every) break;
  await new Promise((r) => setTimeout(r, every * 1000));
}
