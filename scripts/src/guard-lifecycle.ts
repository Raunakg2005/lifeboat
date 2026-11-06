// Quantum Guard v2, the whole lifecycle on a fresh Safe 1.4.1 on Sepolia (testnet only):
//  1. Deploy QuantumGuardFactory (once), create a 1-of-1 Safe, make a new WOTS+C key ("guard2").
//  2. The factory deploys the Safe's guard; ONE Safe transaction installs it as guard + fallback handler (MultiSend).
//  3. A payment co-signed with the PQ key: included.
//  4. The owners start a recovery (what a quantum attacker with the owners' keys could do); the PQ key cancels it.
//  5. The owners start another; finishing early is refused; after the timelock it completes and the owners act alone.
// The timelock here is 2 minutes so the run can show it; the app defaults to 7 days.
// Usage: pnpm --filter @lifeboat/scripts guard-lifecycle
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { concat, decodeErrorResult, encodeAbiParameters, encodeFunctionData, formatEther, parseEther, parseEventLogs, type Address, type Hex } from "viem";
import { fromHex, sign, toHex } from "@lifeboat/pq";
import {
  GUARD_KIND,
  GUARD_SLOT,
  HANDLER_SLOT,
  SAFE_141,
  ZERO_ADDRESS,
  cancelRecoveryHash,
  execTransactionData,
  guardDigest,
  guardFactoryAbi,
  installGuardTx,
  quantumGuardAbi,
  safeAbi,
  safeFactoryAbi,
  safeTxHash,
  simpleSafeTx,
  slotAddress,
} from "@lifeboat/core";
import { repoPath } from "./lib/env.js";
import { forgeBytecode } from "./lib/deployments.js";
import { sepoliaClient, sepoliaDevWallet, withStaleRetry } from "./lib/ens.js";
import { loadOrCreateKey, reserveLeaf, saveKeyFile } from "./lib/pqkey.js";

const CHAIN = 11155111;
const DELAY = 120n;
const statePath = repoPath("deployments", "sepolia.json");
const state: Record<string, any> = JSON.parse(readFileSync(statePath, "utf8"));
state.quantumGuardV2 ??= { txs: {} };
const g = state.quantumGuardV2;
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
const ev: Record<string, any> = { chainId: CHAIN, recoveryDelay: Number(DELAY), startedAt: new Date().toISOString(), steps: [] as any[] };

const pub = sepoliaClient();
const { account: owner, client } = sepoliaDevWallet();
console.log(`owner ${owner.address}: ${formatEther(await pub.getBalance({ address: owner.address }))} Sepolia ETH`);

async function send(what: string, req: { to?: Address; data?: Hex; value?: bigint; gas?: bigint }) {
  const hash = await withStaleRetry(() => client.sendTransaction({ to: req.to ?? null, data: req.data, value: req.value, gas: req.gas } as any));
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 300_000 });
  if (r.status !== "success") throw new Error(`${what} reverted: ${hash}`);
  g.txs[what] = hash;
  save();
  console.log(`✅ ${what}: ${hash} (block ${r.blockNumber}, gas ${r.gasUsed})`);
  ev.steps.push({ what, hash, block: r.blockNumber.toString(), gasUsed: r.gasUsed.toString() });
  return r;
}
const why = async (to: Address, data: Hex) => {
  try {
    await pub.call({ account: owner.address, to, data });
    return "ok";
  } catch (e: any) {
    const raw = e?.walk?.((x: any) => x?.data)?.data as Hex | undefined;
    try {
      return raw ? decodeErrorResult({ abi: quantumGuardAbi, data: raw }).errorName : String(e?.shortMessage ?? e).slice(0, 100);
    } catch {
      return String(e?.shortMessage ?? e).slice(0, 100);
    }
  }
};

// 1. factory, Safe, key
if (!g.factory) {
  g.factory = (await send("deploy QuantumGuardFactory", { data: concat([forgeBytecode("QuantumGuardFactory.sol", "QuantumGuardFactory"), encodeAbiParameters([{ type: "address" }], [state.verifier])]) })).contractAddress;
  save();
}
if (!g.safe) {
  const init = encodeFunctionData({ abi: safeAbi, functionName: "setup", args: [[owner.address], 1n, ZERO_ADDRESS, "0x", SAFE_141.fallbackHandler, ZERO_ADDRESS, 0n, ZERO_ADDRESS] });
  const salt = BigInt(Date.now());
  const { result } = await pub.simulateContract({ account: owner, address: SAFE_141.factory, abi: safeFactoryAbi, functionName: "createProxyWithNonce", args: [SAFE_141.singleton, init, salt] });
  await send("create a fresh Safe 1.4.1 (1-of-1)", { to: SAFE_141.factory, data: encodeFunctionData({ abi: safeFactoryAbi, functionName: "createProxyWithNonce", args: [SAFE_141.singleton, init, salt] }) });
  g.safe = result;
  save();
  await send("fund the Safe (0.004 ETH)", { to: result, value: parseEther("0.004") });
}
const safe = g.safe as Address;
if ((await pub.getBalance({ address: safe })) < parseEther("0.001")) await send("top up the Safe (0.002 ETH)", { to: safe, value: parseEther("0.002") });
const { file: key, key: pair } = loadOrCreateKey("guard2");
console.log(`Safe ${safe} · factory ${g.factory} · PQ key root ${key.root.slice(0, 18)}…`);

// The Safe nonce is read once and then counted here: a load-balanced RPC can answer from a node a block behind,
// and an owner signature over a stale nonce fails with GS026.
let localNonce: bigint | null = null;
const nonce = async () => {
  if (localNonce === null) localNonce = (await pub.readContract({ address: safe, abi: safeAbi, functionName: "nonce" })) as bigint;
  return localNonce++;
};
const ownerSig = async (h: Hex) => (await owner.sign({ hash: h })) as Hex;
const cosign = (kind: number, h: Hex, purpose: string) => {
  const d = guardDigest(CHAIN, g.guard, safe, kind, h);
  const leaf = reserveLeaf(key, purpose, d); // saved before the signature exists
  return { leaf, witness: toHex(sign(pair, leaf, fromHex(d)).witness) as Hex };
};

// 2. guard via the factory, installed in one Safe transaction
if (!g.guard) {
  const predicted = (await pub.readContract({ address: g.factory, abi: guardFactoryAbi, functionName: "predict", args: [safe, key.root as Hex, key.pubSeed as Hex, DELAY] })) as Address;
  await send("factory deploys the Safe's QuantumGuard", { to: g.factory, data: encodeFunctionData({ abi: guardFactoryAbi, functionName: "deploy", args: [safe, key.root as Hex, key.pubSeed as Hex, DELAY] }) });
  g.guard = predicted;
  key.account = predicted;
  saveKeyFile(key);
  save();
}
const guard = g.guard as Address;
if ((slotAddress(await pub.getStorageAt({ address: safe, slot: GUARD_SLOT }))) !== guard.toLowerCase()) {
  const t = installGuardTx(safe, guard, await nonce());
  await send("install: setGuard + setFallbackHandler in ONE Safe transaction (owners only)", { to: safe, data: execTransactionData(t, await ownerSig(safeTxHash(CHAIN, safe, t))), gas: 400_000n });
}
ev.installed = { guard: slotAddress(await pub.getStorageAt({ address: safe, slot: GUARD_SLOT })), handler: slotAddress(await pub.getStorageAt({ address: safe, slot: HANDLER_SLOT })) };
console.log(`installed: guard ${ev.installed.guard}, handler ${ev.installed.handler}`);

// 3. co-signed payment (skipped on a re-run once done)
if (!g.paid) {
  const t = simpleSafeTx(owner.address, parseEther("0.001"), "0x", await nonce());
  const h = safeTxHash(CHAIN, safe, t);
  const { leaf, witness } = cosign(GUARD_KIND.tx, h, "co-signed payment");
  await send(`co-signed payment (PQ leaf ${leaf})`, { to: safe, data: execTransactionData(t, concat([await ownerSig(h), witness])), gas: 600_000n });
  g.paid = true;
  save();
}

const ownersCall = async (fn: "startRecovery" | "finishRecovery") => {
  const t = simpleSafeTx(guard, 0n, encodeFunctionData({ abi: quantumGuardAbi, functionName: fn }), await nonce());
  return execTransactionData(t, await ownerSig(safeTxHash(CHAIN, safe, t)));
};
// the attempt number and ready time come from the receipt's RecoveryStarted event (a load-balanced RPC can lag)
const started = (r: { logs: any[] }) => parseEventLogs({ abi: quantumGuardAbi, logs: r.logs, eventName: "RecoveryStarted" })[0]!.args as { nonce: bigint; readyAt: bigint };
const settle = () => new Promise((r) => setTimeout(r, 6000));

// 4. a recovery the PQ key vetoes
if (!g.vetoed) {
  const r = await send("owners start a recovery (no PQ signature: what a quantum attacker could do)", { to: safe, data: await ownersCall("startRecovery"), gas: 400_000n });
  const { nonce: n } = started(r);
  await settle();
  const d = guardDigest(CHAIN, guard, safe, GUARD_KIND.cancelRecovery, cancelRecoveryHash(n));
  const leaf = reserveLeaf(key, `cancel recovery ${n}`, d);
  const witness = toHex(sign(pair, leaf, fromHex(d)).witness) as Hex;
  await send(`the PQ key cancels recovery #${n} (leaf ${leaf}), relayed by anyone`, { to: guard, data: encodeFunctionData({ abi: quantumGuardAbi, functionName: "cancelRecovery", args: [witness] }), gas: 400_000n });
  g.vetoed = true;
  save();
}

// 5. a recovery that completes after the timelock (the lost-key path)
if (!g.restartReadyAt) {
  const label = "owners start a recovery again (say the PQ key was lost)";
  const prev = g.txs[label] ? await pub.getTransactionReceipt({ hash: g.txs[label] }).catch(() => null) : null;
  const r = prev && prev.status === "success" ? prev : await send(label, { to: safe, data: await ownersCall("startRecovery"), gas: 400_000n });
  g.restartReadyAt = started(r).readyAt.toString();
  save();
}
if (!g.recovered) {
  // finishing early: ask the guard directly as if the Safe called it (eth_call), to show the reason
  try {
    await pub.call({ account: safe, to: guard, data: encodeFunctionData({ abi: quantumGuardAbi, functionName: "finishRecovery" }) });
    ev.finishEarly = "ok";
  } catch (e: any) {
    const raw = e?.walk?.((x: any) => x?.data)?.data as Hex | undefined;
    try {
      ev.finishEarly = raw ? decodeErrorResult({ abi: quantumGuardAbi, data: raw }).errorName : "reverted";
    } catch {
      ev.finishEarly = "reverted";
    }
  }
  console.log(`finishing before the timelock: ${ev.finishEarly}`);
  const readyAt = BigInt(g.restartReadyAt);
  for (;;) {
    const now = (await pub.getBlock()).timestamp;
    if (now >= readyAt + 3n) break;
    console.log(`  waiting for the timelock: ${readyAt + 3n - now} s`);
    await new Promise((r) => setTimeout(r, 15_000));
  }
  await settle();
  await send("owners finish the recovery after the timelock", { to: safe, data: await ownersCall("finishRecovery"), gas: 400_000n });
  g.recovered = true;
  save();
}
{
  const t = simpleSafeTx(owner.address, parseEther("0.0005"), "0x", await nonce());
  await send("after recovery: an owners-only payment goes through", { to: safe, data: execTransactionData(t, await ownerSig(safeTxHash(CHAIN, safe, t))), gas: 400_000n });
}

Object.assign(ev, { safe, guard, factory: g.factory, pqRoot: key.root, leavesUsed: key.nextLeaf, finishedAt: new Date().toISOString() });
mkdirSync(repoPath("evidence", "guard"), { recursive: true });
writeFileSync(repoPath("evidence", "guard", "lifecycle.json"), JSON.stringify(ev, null, 2));
console.log("wrote evidence/guard/lifecycle.json");
