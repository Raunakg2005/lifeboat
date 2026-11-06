import { createPublicClient as arkivPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { desc, eq } from "@arkiv-network/sdk/query";
import { ARKIV_BLOCK_SECONDS, Exposure, PUBLISHER, RPCS, rpcTransport } from "@lifeboat/core";
import sepoliaDeployments from "../../deployments/sepolia.json";
import devnetDeployments from "../../deployments/devnet-1337.json";
import deployDemo from "../../evidence/ef/deploy-demo.json";
import deployNaive from "../../evidence/ef/deploy-naive.json";
import forgery from "../../evidence/ef/forgery.json";
import hardwareRun from "../../evidence/hardware/esp32-frame-tx.json";

export const SEPOLIA_PQ_WALLETS = [sepoliaDeployments.pqWallet] as `0x${string}`[];
/** Our own Sepolia test accounts: left out of every sample of real names, so nothing shown is staged. */
export const OUR_TEST_ACCOUNTS = [sepoliaDeployments.pqWallet, sepoliaDeployments.delegate, sepoliaDeployments.operator] as string[];
export const REPO = "https://github.com/Raunakg2005/lifeboat";

/** The account the devnet forgery run used (its one-time key was re-signed on purpose). */
export const NAIVE_ACCOUNT = forgery.naiveAccount;
/** Every account Lifeboat itself set up for testing, read from the deployment and evidence files: labelled wherever a list shows one. */
const TEST_ACCOUNT_SET = new Set(
  [
    ...OUR_TEST_ACCOUNTS,
    PUBLISHER, // the dev wallet
    forgery.naiveAccount,
    forgery.attacker,
    deployDemo?.account,
    deployNaive?.account,
    devnetDeployments?.rescueEoa,
    hardwareRun?.account,
    sepoliaDeployments.quantumGuard?.safe,
    sepoliaDeployments.quantumGuard?.guard,
    sepoliaDeployments.quantumGuardV2?.safe,
    sepoliaDeployments.quantumGuardV2?.guard,
  ]
    // these files are rewritten when a testnet is reset: skip any field that is missing
    .filter((a): a is string => typeof a === "string")
    .map((a) => a.toLowerCase()),
);
const TEST_NAME_SET = new Set([sepoliaDeployments.name, ...sepoliaDeployments.demoNames]);
export const isTestAccount = (a?: string) => !!a && TEST_ACCOUNT_SET.has(a.toLowerCase());
export const isTestName = (n?: string) => !!n && TEST_NAME_SET.has(n);
export const chainName = (id: string) => ({ "1337": "EIP-8141 devnet", "11155111": "Sepolia", "1": "Ethereum" })[id] ?? `chain ${id}`;

export const sepoliaClient = createPublicClient({ chain: sepolia, batch: { multicall: true }, transport: rpcTransport(RPCS.sepolia) }) as PublicClient;
export const sepoliaLogs = createPublicClient({ chain: sepolia, transport: rpcTransport(RPCS.sepoliaLogs, { timeout: 60_000 }) }) as PublicClient;
// Safe deep scan: batched mainnet reads, and Tenderly's public gateway for full-range logs
export const safeClient = createPublicClient({ chain: mainnet, transport: rpcTransport(RPCS.mainnet, { batch: { batchSize: 50 } }) }) as PublicClient;
export const safeLogs = createPublicClient({ chain: mainnet, transport: rpcTransport(RPCS.mainnetLogs, { timeout: 60_000 }) }) as PublicClient;
export const mainnetClient = createPublicClient({ chain: mainnet, transport: rpcTransport(RPCS.mainnet, { timeout: 20_000 }) }) as PublicClient;

// Once the public endpoint's free query budget is spent it answers 429 with a Retry-After of minutes, which viem would
// wait out on every request. Drop that header so the read fails fast and the page can say so.
// Keyless reads share a per-IP budget, so the same query (ignoring its JSON-RPC id) is answered from memory for 90 s:
// switching tabs doesn't spend it again. Memory only: nothing is saved in the browser.
const ARKIV_CACHE_MS = 90_000;
const arkivCache = new Map<string, { at: number; ids: unknown[]; json: unknown }>();
const rpcIds = (r: any): unknown[] => (Array.isArray(r) ? r.map((x) => x?.id) : [r?.id]);
const withoutIds = (r: any) => JSON.stringify(Array.isArray(r) ? r.map(({ id: _id, ...x }) => x) : (({ id: _id, ...x }) => x)(r));
const arkivFetch: typeof fetch = async (input, init) => {
  let req: any = null;
  try {
    req = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  } catch {
    req = null;
  }
  const key = req ? withoutIds(req) : "";
  const hit = key ? arkivCache.get(key) : undefined;
  if (hit && Date.now() - hit.at < ARKIV_CACHE_MS) {
    const ids = rpcIds(req);
    const relabel = (r: any) => ({ ...r, id: ids[hit.ids.indexOf(r?.id)] ?? r?.id });
    const out = Array.isArray(hit.json) ? hit.json.map(relabel) : relabel(hit.json);
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  }
  const res = await fetch(input, init);
  if (res.ok && key) {
    try {
      const json = await res.clone().json();
      const failed = Array.isArray(json) ? json.some((r) => r?.error) : (json as any)?.error;
      if (!failed) arkivCache.set(key, { at: Date.now(), ids: rpcIds(req), json });
    } catch {
      // not JSON: don't cache
    }
  }
  if (res.status !== 429 || !(Number(res.headers.get("Retry-After")) > 5)) return res;
  const headers = new Headers(res.headers);
  headers.delete("Retry-After");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};
// Arkiv reads work without a key (rate-limited public endpoint). No key in the browser: anything VITE_ is public.
export const arkiv = arkivPublicClient({ chain: rabdi({ accessKey: "" }), transport: http(undefined, { fetchFn: arkivFetch }) });
/** A plain sentence for a failed Arkiv read. */
export const arkivErrorText = (e: unknown) => {
  const err = e as { shortMessage?: string; message?: string; details?: string; status?: number };
  if (err?.status === 429 || /429|COST_LIMITED|budget exhausted/i.test(`${err?.details ?? ""} ${err?.message ?? ""}`)) return "the free public query quota is used up for a few minutes. Try again shortly.";
  return String(err?.shortMessage ?? err?.message ?? e).slice(0, 200);
};

export const short = (a: string, n = 6) => (a.length > 2 * n + 2 ? `${a.slice(0, n + 2)}…${a.slice(-n + 2)}` : a);
export const explorerTx = (h: string) => `https://explorer.altmempool.wtf/tx/${h}?node=${encodeURIComponent("https://altmempoolgateway.forshtat.com/rpc")}`;
export const sepoliaTx = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;
export const sepoliaAddr = (a: string) => `https://sepolia.etherscan.io/address/${a}`;

export const SWARM_GATEWAY = "https://api.gateway.testnet.ethswarm.org";
export const swarmUrl = (ref: string) => `${SWARM_GATEWAY}/bzz/${ref}/`;

// ---------- Arkiv: explorer links and the system fields every row carries ----------
export const ARKIV_EXPLORER = "https://rabdi.explorer.arkiv.network";
export const arkivEntityUrl = (key: string) => `${ARKIV_EXPLORER}/entity/${key}`;
export const arkivTxUrl = (hash: string) => `${ARKIV_EXPLORER}/tx/${hash}`;
export const arkivAddressUrl = (a: string) => `${ARKIV_EXPLORER}/address/${a}`;

/** "expires in 18 h", from an entity's $expiresAt and the block it was read at. */
export const expiresIn = (expiresAt: bigint, block: bigint) => {
  const s = Number(expiresAt - block) * ARKIV_BLOCK_SECONDS;
  if (s <= 0) return "expired";
  if (s < 3600) return `expires in ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 2 * 86400) return `expires in ${Math.round(s / 3600)} h`;
  return `expires in ${Math.round(s / 86400)} d`;
};
/** Seconds left until $expiresAt, for the countdown rings. */
export const secondsLeft = (expiresAt: bigint, block: bigint) => Number(expiresAt - block) * ARKIV_BLOCK_SECONDS;

/** The stamp drawn from an entity's $creationFlags. */
export type Flags = { readonly: boolean; permissionlessExtension: boolean };
export const flagsText = (f: Flags) => `${f.readonly ? "readonly" : "editable"} · ${f.permissionlessExtension ? "anyone can extend" : "owner extends"}`;
export const isAuditGrade = (f?: Flags) => !!f && f.readonly && f.permissionlessExtension;

/** Who wrote an entity, from its $owner. */
export const isPublisher = (owner: string) => owner.toLowerCase() === PUBLISHER.toLowerCase();
export const writerLabel = (owner: string) => (isPublisher(owner) ? "Lifeboat publisher" : `other writer ${short(owner, 4)}`);

/** The Arkiv side of a piece of evidence: the entity, the Swarm file it names, and the fields the file should agree with. */
export type EvidenceRecord = {
  key: string;
  kind: "exposure" | "name" | "aboard";
  swarmRef: string;
  evidenceHash?: string;
  block?: string;
  verdict?: string;
  status?: string;
  address?: string;
  name?: string;
  txHash?: string;
};

/** An EvidenceRecord from an Exposure row's fields. */
export function exposureEvidence(
  key: string,
  e: { address: { value: string }; status: { value: string }; checkedBlock: { value: bigint }; swarmRef?: { value: string }; evidenceHash?: { value: string } },
): EvidenceRecord {
  return { key, kind: "exposure", swarmRef: e.swarmRef?.value ?? "", evidenceHash: e.evidenceHash?.value, address: e.address.value, status: e.status.value, block: String(e.checkedBlock.value) };
}

/** Live Exposure records that name one Swarm file, newest per key (the council scan is written with via = safe-signature). */
export async function findExposureRecords(swarmRef: string, via: string): Promise<EvidenceRecord[]> {
  const r = await arkiv
    .select({ $key: true, $createdAt: true, address: true, chainId: true, status: true, checkedBlock: true, swarmRef: true, evidenceHash: true })
    .from(Exposure)
    .where(eq("via", via))
    .ownedBy(PUBLISHER)
    .orderBy(desc("$expiresAt"))
    .limit(100)
    .fetch();
  const rows = r.entities
    .filter((e) => e.swarmRef?.value === swarmRef)
    .map((e) => ({ createdAt: e.$createdAt, address: e.address.value, chainId: String(e.chainId.value), rec: exposureEvidence(e.$key, e) }));
  return newestPer(rows, (x) => `${x.address.toLowerCase()}:${x.chainId}`).map((x) => x.rec);
}

/** Re-checks write new entities: keep only the newest per id, by $createdAt. */
export function newestPer<T extends { createdAt: bigint }>(rows: readonly T[], id: (r: T) => string): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const k = id(r);
    const cur = best.get(k);
    if (!cur || r.createdAt > cur.createdAt) best.set(k, r);
  }
  return [...best.values()];
}
