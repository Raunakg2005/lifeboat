// The ENSv2 handover, verified by the registry itself:
//   0. Helm check before (saved)
//   1. naive transfer to the PQ wallet -> the registry REFUSES: TransferUnsafeWithMultipleAssignees
//      (sent on-chain on purpose, so the refusal is a public, failed transaction)
//   2. new resolver for the PQ wallet (factory proxy, PQ wallet holds every role, pq.* records set at init)
//   3. point the name at it (escapes the old-resolver trap)
//   4. revoke the extra delegate, 5. remove the operator
//   6. transfer again -> the registry ACCEPTS
//   7. the PQ wallet proves control: a WOTS+C-signed setText relayed by anyone
//   8. Helm check after (saved)
// Usage: pnpm --filter @lifeboat/scripts ens-handover
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { decodeErrorResult, encodeFunctionData, keccak256, toHex, type Address, type Hex } from "viem";
import { fromHex, sign, toHex as pqHex } from "@lifeboat/pq";
import { repoPath } from "./lib/env.js";
import { ALL_ROLES, ENS, REGISTRY_ROLES, dnsEncode, factoryAbi, mainnetClient, registryAbi, resolverAbi, sepoliaClient, sepoliaDevWallet, sepoliaLogsClient, withStaleRetry } from "./lib/ens.js";
import { helmCheck, printReport, type HelmReport } from "@lifeboat/core";
import { loadOrCreateKey, reserveLeaf } from "./lib/pqkey.js";
import { pqWalletAbi, walletDigest, type Call } from "./lib/pqwallet.js";

const dep = JSON.parse(readFileSync(repoPath("deployments", "sepolia.json"), "utf8"));
const name: string = dep.name;
const label = name.split(".")[0]!;
const dns = dnsEncode(name);
const pqWallet = dep.pqWallet as Address;
const pub = sepoliaClient();
const { account: dev, client } = sepoliaDevWallet();
const evidence: Record<string, unknown> = { name, pqWallet, steps: [] as unknown[] };
const steps = evidence.steps as unknown[];
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);
const saveEv = () => {
  mkdirSync(repoPath("evidence", "ens"), { recursive: true });
  writeFileSync(repoPath("evidence", "ens", "handover.json"), json(evidence));
};

// public RPCs are load-balanced; a backend can lag a block or two behind our own writes
const settle = () => new Promise((r) => setTimeout(r, 15_000));
const check = async (when: string): Promise<HelmReport> => {
  for (let i = 0; i < 3; i++) {
    try {
      return await checkOnce(when);
    } catch (e) {
      if (i === 2) throw e;
      console.log(`helm check hit a lagging RPC backend, retrying (${String((e as Error).message).slice(0, 80)})`);
      await settle();
    }
  }
  throw new Error("unreachable");
};
const checkOnce = async (when: string): Promise<HelmReport> => {
  const r = await helmCheck(pub as any, sepoliaLogsClient() as any, [mainnetClient() as any], name, { pqWallets: [pqWallet] });
  printReport(r);
  writeFileSync(repoPath("evidence", "ens", `helm-${name}-${when}-${r.block}.json`), json(r));
  return r;
};
const tokenId = async () => (await pub.readContract({ address: ENS.ETHRegistry, abi: registryAbi, functionName: "findTokenId", args: [label] })) as bigint;

async function send(what: string, to: Address, data: Hex, gas?: bigint) {
  const hash = await withStaleRetry(() => client.sendTransaction({ to, data, gas } as any));
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 300_000 });
  steps.push({ what, hash, status: r.status, block: r.blockNumber, gasUsed: r.gasUsed });
  saveEv();
  console.log(`${r.status === "success" ? "✅" : "❌"} ${what}: ${hash} (block ${r.blockNumber})`);
  return r;
}

const before = await check("before");
evidence.before = { verdict: before.verdict, hijackablePaths: before.hijackablePaths, block: before.block };
if (before.owner.toLowerCase() !== dev.address.toLowerCase()) throw new Error(`owner is ${before.owner}, not the dev wallet: already handed over?`);

// 1. the naive move: just transfer the token
const naive = encodeFunctionData({ abi: registryAbi, functionName: "safeTransferFrom", args: [dev.address, pqWallet, await tokenId(), 1n, "0x"] });
try {
  await pub.call({ account: dev, to: ENS.ETHRegistry, data: naive });
  throw new Error("expected the registry to refuse the naive transfer");
} catch (e: any) {
  const data = (e?.cause?.data ?? e?.data ?? e?.walk?.((x: any) => x?.data)?.data) as Hex | undefined;
  let decoded = "unknown";
  try {
    if (data) {
      const d = decodeErrorResult({ abi: registryAbi, data });
      decoded = `${d.errorName}(${(d.args ?? []).map(String).join(", ")})`;
    }
  } catch {}
  console.log(`registry refuses the naive transfer: ${decoded}`);
  evidence.naiveRefusal = decoded;
}
await send("1. naive transfer to the PQ wallet (refused on purpose)", ENS.ETHRegistry, naive, 300_000n);

// 2. a fresh resolver for the PQ wallet; records set at init, so no leaf is spent on them
const { file: key, key: pqKey } = loadOrCreateKey("sepolia");
const now = new Date().toISOString();
const init = encodeFunctionData({
  abi: resolverAbi,
  functionName: "initialize",
  args: [
    [{ account: pqWallet, roleBitmap: ALL_ROLES }],
    [
      encodeFunctionData({ abi: resolverAbi, functionName: "setAddress", args: [dns, 60n, pqWallet] }),
      encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dns, "pq.status", "protected"] }),
      encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dns, "pq.scheme", "WOTS+C-keccak-w16-S560-h8"] }),
      encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dns, "pq.root", key.root] }),
      encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dns, "pq.account", pqWallet] }),
      encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dns, "pq.checked", now] }),
    ],
  ],
});
const salt = BigInt(keccak256(toHex(`lifeboat-pq-resolver-${label}-${Date.now()}`)));
const sim = await pub.simulateContract({ account: dev, address: ENS.VerifiableFactory, abi: factoryAbi, functionName: "deployProxy", args: [ENS.PermissionedResolverImpl, salt, init] });
const newResolver = sim.result as Address;
await send("2. new resolver for the PQ wallet (pq.* records at init)", ENS.VerifiableFactory, encodeFunctionData({ abi: factoryAbi, functionName: "deployProxy", args: [ENS.PermissionedResolverImpl, salt, init] }));
const relayerRoles = (await pub.readContract({ address: newResolver, abi: resolverAbi, functionName: "roles", args: [0n, dev.address] })) as bigint;
console.log(`new resolver ${newResolver}; relayer (dev wallet) roles on it: ${relayerRoles}`);
evidence.newResolver = newResolver;
evidence.relayerRolesOnNewResolver = relayerRoles;

// 3. point the name at it
await send("3. setResolver to the PQ wallet's resolver", ENS.ETHRegistry, encodeFunctionData({ abi: registryAbi, functionName: "setResolver", args: [await tokenId(), newResolver] }));
// 4. revoke the extra delegate
await send("4. revoke the extra delegate's SET_RESOLVER", ENS.ETHRegistry, encodeFunctionData({ abi: registryAbi, functionName: "revokeRoles", args: [await tokenId(), REGISTRY_ROLES.SET_RESOLVER!, dep.delegate] }));
// 5. remove the operator
await send("5. remove the operator", ENS.ETHRegistry, encodeFunctionData({ abi: registryAbi, functionName: "setApprovalForAll", args: [dep.operator, false] }));
// 6. transfer again (the token id was regenerated by the role change: re-read it)
await send("6. transfer to the PQ wallet (accepted)", ENS.ETHRegistry, encodeFunctionData({ abi: registryAbi, functionName: "safeTransferFrom", args: [dev.address, pqWallet, await tokenId(), 1n, "0x"] }));
await settle();
const owner = (await pub.readContract({ address: ENS.ETHRegistry, abi: registryAbi, functionName: "findOwner", args: [label] })) as Address;
console.log(`owner now ${owner}`);
evidence.ownerAfter = owner;

// 7. the PQ wallet acts with a one-time WOTS+C signature (dev wallet only relays)
const calls: Call[] = [{ target: newResolver, value: 0n, data: encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dns, "pq.checked", `${new Date().toISOString()} signed by the PQ key`] }) }];
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const leaf = key.nextLeaf;
const digest = walletDigest(11155111n, pqWallet, BigInt(leaf), deadline, calls);
if (reserveLeaf(key, `ENS setText pq.checked on ${name}`, digest) !== leaf) throw new Error("leaf changed");
const { witness } = sign(pqKey, leaf, fromHex(digest));
await send(`7. PQ wallet sets pq.checked (WOTS+C leaf ${leaf}, relayed)`, pqWallet, encodeFunctionData({ abi: pqWalletAbi, functionName: "execute", args: [BigInt(leaf), deadline, calls, pqHex(witness)] }), 1_500_000n);
evidence.pqSignedLeaf = leaf;
saveEv();
await settle();

const after = await check("after");
evidence.after = { verdict: after.verdict, hijackablePaths: after.hijackablePaths, block: after.block, owner: after.owner, resolver: after.resolver };
saveEv();
console.log(`\nbefore: ${before.verdict} (paths ${before.hijackablePaths.join(", ")})  ->  after: ${after.verdict}`);
