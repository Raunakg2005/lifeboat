// Helm check: who can steer an ENSv2 name, and which of them a quantum computer could impersonate.
//
// Five control paths:
//   1. owner        - holds the name's token in its parent registry
//   2. delegates    - other accounts with roles on the name (EAC on the registry)
//   3. operators    - ERC-1155 approved-for-all operators of the owner: they can move the name
//   4. resolver     - role holders on the name's resolver (can rewrite address/text records; UPGRADE can replace its code)
//   5. parents      - root-role holders of the parent registries (systemic, outside the owner's control)
//
// EAC stores only role *counts* on-chain, so holders are rebuilt from EACRolesChanged logs and then proven
// complete: each role is one nybble, so the sum of every holder's bitmap must equal roleCount(resource).
import { getAddress, parseAbiItem, type Address, type PublicClient } from "viem";
import { ENS, ENS_V2_FROM_BLOCK, REGISTRY_ROLES, RESOLVER_ROLES, dnsEncode, helperAbi, registryAbi, resolverAbi, roleNames } from "./ens.js";

const EAC_ROLES_CHANGED = parseAbiItem("event EACRolesChanged(uint256 indexed resource, address indexed account, uint256 oldRoleBitmap, uint256 newRoleBitmap)");
const APPROVAL_FOR_ALL = parseAbiItem("event ApprovalForAll(address indexed account, address indexed operator, bool approved)");

export type ExposureStatus = "exposed" | "not-seen" | "pq-wallet" | "contract";
export interface Controller {
  address: Address;
  exposure: ExposureStatus;
  detail: string; // e.g. "EOA, 3 txs on Sepolia" / "LifeboatPQWallet (WOTS+C)"
}
export interface PathEntry {
  path: 1 | 2 | 3 | 4 | 5;
  title: string;
  holder: Controller;
  power: string[]; // role names or "transfer the name"
  where: string; // contract + resource
}
export interface HelmReport {
  name: string;
  checkedAt: string;
  block: bigint;
  parentRegistry: Address;
  tokenId: bigint;
  resource: bigint;
  owner: Address;
  resolver: Address;
  entries: PathEntry[];
  completeness: { where: string; resource: bigint; rebuilt: bigint; onChain: bigint; complete: boolean }[];
  hijackablePaths: number[]; // owner-controllable paths (1-4) with an exposed holder
  systemicExposed: number; // exposed holders in path 5
  verdict: "hijackable" | "protected" | "unknown";
}

async function logsAll(client: PublicClient, params: any, from: bigint, to: bigint): Promise<any[]> {
  try {
    return await client.getLogs({ ...params, fromBlock: from, toBlock: to });
  } catch (e) {
    const msg = String((e as Error).message);
    if (to - from < 2n || !/more than|range|limit|exceed/i.test(msg)) throw e;
    const mid = (from + to) / 2n;
    return [...(await logsAll(client, params, from, mid)), ...(await logsAll(client, params, mid + 1n, to))];
  }
}

/** Current role holders of `resource` on an EAC contract, rebuilt from logs and checked against roleCount. */
async function holders(client: PublicClient, logs: PublicClient, contract: Address, abi: any, resource: bigint | undefined, toBlock: bigint) {
  const evs = await logsAll(logs, { address: contract, event: EAC_ROLES_CHANGED, args: resource === undefined ? {} : { resource } }, ENS_V2_FROM_BLOCK, toBlock);
  const pairs = new Map<string, { resource: bigint; account: Address }>();
  for (const e of evs) pairs.set(`${e.args.resource}:${e.args.account}`, { resource: e.args.resource, account: getAddress(e.args.account) });
  const read = await Promise.all(
    [...pairs.values()].map(async (p) => ({ ...p, bitmap: (await client.readContract({ address: contract, abi, functionName: "roles", args: [p.resource, p.account], blockNumber: toBlock })) as bigint })),
  );
  const out = read.filter((h) => h.bitmap !== 0n);
  const resources = [...new Set(out.map((h) => h.resource))];
  if (resource !== undefined && !resources.includes(resource)) resources.push(resource);
  const completeness = await Promise.all(
    resources.map(async (r) => {
      const rebuilt = out.filter((h) => h.resource === r).reduce((s, h) => s + h.bitmap, 0n);
      const onChain = (await client.readContract({ address: contract, abi, functionName: "roleCount", args: [r], blockNumber: toBlock })) as bigint;
      return { resource: r, rebuilt, onChain, complete: rebuilt === onChain };
    }),
  );
  return { holders: out, completeness };
}

export async function classify(client: PublicClient, others: PublicClient[], a: Address, known: { pqWallets: Address[] }): Promise<Controller> {
  const code = await client.getCode({ address: a });
  if (code && code !== "0x") {
    if (known.pqWallets.some((w) => w.toLowerCase() === a.toLowerCase())) return { address: a, exposure: "pq-wallet", detail: "LifeboatPQWallet (WOTS+C, hash-based)" };
    try {
      const threshold = await client.readContract({ address: a, abi: [parseAbiItem("function getThreshold() view returns (uint256)")], functionName: "getThreshold" });
      return { address: a, exposure: "contract", detail: `Safe, threshold ${threshold} (signers need a deep scan)` };
    } catch {}
    return { address: a, exposure: "contract", detail: `contract (${(code.length - 2) / 2} bytes)` };
  }
  const counts = await Promise.all([client, ...others].map((c) => c.getTransactionCount({ address: a }).catch(() => 0)));
  const total = counts.reduce((s, n) => s + n, 0);
  return total > 0
    ? { address: a, exposure: "exposed", detail: `EOA, ${counts.join(" / ")} txs (Sepolia / mainnet): public key on-chain` }
    : { address: a, exposure: "not-seen", detail: "EOA with no transactions yet: public key not revealed" };
}

export async function helmCheck(
  client: PublicClient,
  logs: PublicClient,
  others: PublicClient[],
  name: string,
  known: { pqWallets: Address[]; onStep?: (step: string) => void },
): Promise<HelmReport> {
  const step = known.onStep ?? (() => {});
  step("Finding the registry that holds the name");
  const block = await client.getBlockNumber();
  const dns = dnsEncode(name);
  const label = name.split(".")[0]!;
  const parentRegistry = getAddress((await client.readContract({ address: ENS.UniversalHelper, abi: helperAbi, functionName: "findParentRegistry", args: [dns], blockNumber: block })) as Address);
  const read = (fn: string, args: any[], address: Address = parentRegistry, abi: any = registryAbi) => client.readContract({ address, abi, functionName: fn, args, blockNumber: block });

  const [tokenId, resolverRaw, registriesRaw] = (await Promise.all([
    read("findTokenId", [label]),
    read("getResolver", [label]),
    client.readContract({ address: ENS.UniversalHelper, abi: helperAbi, functionName: "findRegistries", args: [dns], blockNumber: block }),
  ])) as [bigint, Address, Address[]];
  const [state, ownerRaw] = (await Promise.all([read("getState", [tokenId]), read("getOwner", [tokenId])])) as [{ status: number; resource: bigint }, Address];
  const owner = getAddress(ownerRaw);
  const resolver = getAddress(resolverRaw);
  const resource = state.resource;

  const cache = new Map<string, Promise<Controller>>();
  const who = (a: Address) => {
    const k = a.toLowerCase();
    if (!cache.has(k)) cache.set(k, classify(client, others, a, known));
    return cache.get(k)!;
  };
  const completeness: HelmReport["completeness"] = [];
  const registries = [...new Set(registriesRaw.map((a) => getAddress(a)).filter((a) => a !== "0x0000000000000000000000000000000000000000"))];
  step("Rebuilding every role list from the logs (5 paths in parallel)");

  // all five paths in parallel
  const [p1, p2, p3, p4, p5] = await Promise.all([
    // 1. owner
    (async (): Promise<PathEntry[]> => [{ path: 1, title: "owner", holder: await who(owner), power: ["owns the name token"], where: `registry ${parentRegistry}` }])(),
    // 2. delegates (the owner's own roles are skipped)
    (async (): Promise<PathEntry[]> => {
      const reg = await holders(client, logs, parentRegistry, registryAbi, resource, block);
      for (const c of reg.completeness) completeness.push({ where: `registry ${parentRegistry}`, ...c });
      return Promise.all(
        reg.holders
          .filter((h) => h.account !== owner)
          .map(async (h) => ({ path: 2 as const, title: "delegate", holder: await who(h.account), power: roleNames(h.bitmap, REGISTRY_ROLES), where: `registry ${parentRegistry}, resource ${h.resource}` })),
      );
    })(),
    // 3. operators of the owner (they can transfer every name the owner holds in this registry)
    (async (): Promise<PathEntry[]> => {
      const ops = await logsAll(logs, { address: parentRegistry, event: APPROVAL_FOR_ALL, args: { account: owner } }, ENS_V2_FROM_BLOCK, block);
      const found = await Promise.all([...new Set(ops.map((e) => getAddress(e.args.operator)))].map(async (op) => ((await read("isApprovedForAll", [owner, op])) ? op : null)));
      return Promise.all(found.filter((op): op is Address => !!op).map(async (op) => ({ path: 3 as const, title: "operator", holder: await who(op), power: ["transfer the name (ERC-1155 approved for all)"], where: `registry ${parentRegistry}` })));
    })(),
    // 4. resolver role holders (all resources: root = whole resolver, others = per-name/per-record setters)
    (async (): Promise<PathEntry[]> => {
      if (resolver === "0x0000000000000000000000000000000000000000") return [];
      const res = await holders(client, logs, resolver, resolverAbi, undefined, block);
      for (const c of res.completeness) completeness.push({ where: `resolver ${resolver}`, ...c });
      return Promise.all(
        res.holders.map(async (h) => ({
          path: 4 as const,
          title: h.resource === 0n ? "resolver admin" : "record setter",
          holder: await who(h.account),
          power: roleNames(h.bitmap, RESOLVER_ROLES),
          where: `resolver ${resolver}, resource ${h.resource === 0n ? "root" : h.resource}`,
        })),
      );
    })(),
    // 5. parent registries: root-role holders of every registry above the name
    (async (): Promise<PathEntry[]> => {
      const per = await Promise.all(
        registries.map(async (r) => {
          const root = await holders(client, logs, r, registryAbi, 0n, block);
          return Promise.all(root.holders.map(async (h) => ({ path: 5 as const, title: "parent registry admin", holder: await who(h.account), power: roleNames(h.bitmap, REGISTRY_ROLES), where: `registry ${r}, root` })));
        }),
      );
      return per.flat();
    })(),
  ]);
  step("Classifying every key and proving the lists complete");
  const entries: PathEntry[] = [...p1, ...p2, ...p3, ...p4, ...p5];

  const hijackablePaths = [...new Set(entries.filter((e) => e.path <= 4 && e.holder.exposure === "exposed").map((e) => e.path))].sort();
  const systemicExposed = new Set(entries.filter((e) => e.path === 5 && e.holder.exposure === "exposed").map((e) => e.holder.address)).size;
  const allComplete = completeness.every((c) => c.complete);
  return {
    name,
    checkedAt: new Date().toISOString(),
    block,
    parentRegistry,
    tokenId,
    resource,
    owner,
    resolver,
    entries,
    completeness,
    hijackablePaths,
    systemicExposed,
    verdict: !allComplete ? "unknown" : hijackablePaths.length ? "hijackable" : "protected",
  };
}

export function printReport(r: HelmReport) {
  const icon = (e: ExposureStatus) => ({ exposed: "🔴 exposed", "not-seen": "🟡 not seen", "pq-wallet": "🟢 PQ", contract: "⚪ contract" })[e];
  console.log(`\nHelm check: ${r.name}  (Sepolia block ${r.block})`);
  console.log(`owner ${r.owner}, resolver ${r.resolver}`);
  const titles = ["", "1 owner", "2 delegates", "3 operators", "4 resolver", "5 parents"];
  for (const p of [1, 2, 3, 4, 5]) {
    const es = r.entries.filter((e) => e.path === p);
    console.log(`  path ${titles[p]}: ${es.length ? "" : "none"}`);
    for (const e of es) console.log(`    ${icon(e.holder.exposure).padEnd(13)} ${e.holder.address}  ${e.power.join(", ")}  [${e.holder.detail}]`);
  }
  for (const c of r.completeness) console.log(`  completeness ${c.where} resource ${c.resource === 0n ? "root" : c.resource.toString().slice(0, 12) + "…"}: ${c.complete ? "✅ proven complete" : `❌ rebuilt ${c.rebuilt} vs roleCount ${c.onChain}`}`);
  console.log(
    r.verdict === "hijackable"
      ? `\nVERDICT: HIJACKABLE ON Q-DAY through path(s) ${r.hijackablePaths.join(", ")} (keys already public on-chain)`
      : r.verdict === "protected"
        ? "\nVERDICT: protected: no exposed key controls this name (parent registries aside)"
        : "\nVERDICT: unknown (role list could not be proven complete)",
  );
  if (r.systemicExposed) console.log(`(systemic: ${r.systemicExposed} exposed parent-registry admin key(s), outside the owner's control)`);
}
