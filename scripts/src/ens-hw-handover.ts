// Hands an ENSv2 name to a post-quantum wallet whose key lives only on the ESP32, then proves control with a
// clear-signed change: the device shows "setText · name … · key pq.checked = …" and signs after the BOOT press.
//   0. the device's public key → its LifeboatPQWallet address (CREATE2, salt = root); deployed if it isn't yet
//   1. Helm check before (saved); the naive transfer is simulated and refused by the registry
//   2. fresh resolver where only the PQ wallet holds roles, 3. point the name at it, 4. revoke other delegates,
//   5. remove operators, 6. transfer the name to the PQ wallet: every step from the current owner (the dev wallet)
//   7. the PQ wallet sets pq.checked: request built here, shown and signed on the device, relayed by the dev wallet
//   8. Helm check after (saved)
// Usage: pnpm --filter @lifeboat/scripts ens-hw-handover --name lifeboathw.eth [--port COM5]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { decodeErrorResult, encodeFunctionData, type Address, type Hex, type TransactionReceipt } from "viem";
import { toHex } from "@lifeboat/pq";
import {
  deployPqWalletTx,
  deployResolverTx,
  executeData,
  factoryAbi,
  handoverPlan,
  helmCheck,
  pqWalletAbi,
  pqWalletAddress,
  pqWalletRequest,
  printReport,
  registryAbi,
  removeOperatorData,
  resolverAbi,
  resolverInitData,
  resolverSalt,
  revokeRolesData,
  setResolverData,
  setTextCalls,
  transferNameData,
  ENS,
  type HelmReport,
} from "@lifeboat/core";
import { argValue, repoPath } from "./lib/env.js";
import { mainnetClient, sepoliaClient, sepoliaDevWallet, sepoliaLogsClient, withStaleRetry } from "./lib/ens.js";
import { openDevice } from "./lib/device.js";

const name = argValue("--name");
if (!name || !name.endsWith(".eth")) throw new Error("usage: ens-hw-handover --name <label>.eth");
const label = name.slice(0, -4);
const pub = sepoliaClient();
const { account: dev, client } = sepoliaDevWallet();
const evPath = repoPath("evidence", "ens", `hw-handover-${label}.json`);
let evidence: Record<string, any> = { name, steps: [] as any[], startedAt: new Date().toISOString() };
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);
const save = () => {
  mkdirSync(repoPath("evidence", "ens"), { recursive: true });
  writeFileSync(evPath, json(evidence));
};

// reads pinned to a block at least as new as our last receipt: a lagging RPC node errors and the fallback moves on
let minBlock = 0n;
const at = async () => {
  const b = await pub.getBlockNumber();
  return { blockNumber: b > minBlock ? b : minBlock };
};
const read = async <T>(address: Address, abi: any, functionName: string, args: any[] = []): Promise<T> => {
  for (let i = 0; ; i++) {
    try {
      return (await pub.readContract({ address, abi, functionName, args, ...(await at()) })) as T;
    } catch (e) {
      if (i >= 8) throw e;
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
};
const tokenId = () => read<bigint>(ENS.ETHRegistry, registryAbi, "findTokenId", [label]);

async function send(what: string, to: Address, data: Hex, gas?: bigint): Promise<TransactionReceipt> {
  const hash = await withStaleRetry(() => client.sendTransaction({ to, data, gas } as any));
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 300_000 });
  if (r.blockNumber > minBlock) minBlock = r.blockNumber;
  evidence.steps.push({ what, hash, status: r.status, block: r.blockNumber, gasUsed: r.gasUsed });
  save();
  console.log(`${r.status === "success" ? "✅" : "❌"} ${what}: ${hash} (block ${r.blockNumber})`);
  if (r.status !== "success") throw new Error(`${what} reverted`);
  return r;
}

async function check(when: string, wallet: Address): Promise<HelmReport> {
  for (let i = 0; ; i++) {
    try {
      const r = await helmCheck(pub as any, sepoliaLogsClient() as any, [mainnetClient() as any], name!, { pqWallets: [wallet] });
      if (r.block < minBlock) throw new Error(`stale: block ${r.block} < ${minBlock}`);
      printReport(r);
      writeFileSync(repoPath("evidence", "ens", `helm-${name}-${when}-${r.block}.json`), json(r));
      return r;
    } catch (e) {
      if (i >= 3) throw e;
      console.log(`helm check retry (${String((e as Error).message).slice(0, 80)})`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
}

// 0. the device and its wallet
const device = await openDevice(argValue("--port") ?? "COM5");
let info = await device.ensureUnlocked(await device.info());
console.log(`device key ${toHex(info.root).slice(0, 12)}…, next leaf ${info.next}; reading its public tree…`);
const levels = await device.tree(info);
const rootHex = toHex(info.root) as Hex;
const wallet = pqWalletAddress(rootHex, toHex(info.pubSeed) as Hex);
evidence.device = { root: rootHex, pubSeed: toHex(info.pubSeed), wallet };
console.log(`the device's post-quantum wallet: ${wallet}`);
if (!(await pub.getCode({ address: wallet, ...(await at()) }))) {
  const tx = deployPqWalletTx(rootHex, toHex(info.pubSeed) as Hex);
  const gas = ((await pub.estimateGas({ account: dev, to: tx.to, data: tx.data })) * 12n) / 10n; // ~6.6M: deploy cost, measured
  await send("0. deploy the device's PQ wallet (CREATE2 from its public key)", tx.to, tx.data, gas);
}
const onChainRoot = await read<Hex>(wallet, pqWalletAbi, "root");
if (onChainRoot.toLowerCase() !== rootHex.toLowerCase()) throw new Error(`wallet root ${onChainRoot} != device root`);

// 1. before
const before = await check("before-hw", wallet);
// resume: the handover already landed (e.g. nobody pressed BOOT last time): keep its evidence, go to the device step
const handedOver = before.owner.toLowerCase() === wallet.toLowerCase();
if (handedOver) {
  if (existsSync(evPath)) evidence = { ...JSON.parse(readFileSync(evPath, "utf8")), resumedAt: new Date().toISOString() };
  console.log(`${name} already belongs to the device's wallet: going straight to the device-signed change`);
} else {
  evidence.before = { verdict: before.verdict, hijackablePaths: before.hijackablePaths, owner: before.owner, resolver: before.resolver, block: before.block };
  if (before.owner.toLowerCase() !== dev.address.toLowerCase()) throw new Error(`${name} is owned by ${before.owner}, not the dev wallet`);
}
let resolver: Address | null = handedOver ? before.resolver : null;
if (!handedOver) {
try {
  await pub.call({ account: dev, to: ENS.ETHRegistry, data: transferNameData(dev.address, wallet, await tokenId()) });
  evidence.naiveTransfer = "accepted (unexpected)";
} catch (e: any) {
  const data = (e?.cause?.data ?? e?.data ?? e?.walk?.((x: any) => x?.data)?.data) as Hex | undefined;
  let decoded = "reverted";
  try {
    if (data) decoded = decodeErrorResult({ abi: registryAbi, data }).errorName;
  } catch {}
  evidence.naiveTransfer = `refused: ${decoded}`;
}
console.log(`naive transfer to the PQ wallet: ${evidence.naiveTransfer}`);

// 2-6. the handover, step by step
const plan = handoverPlan(before, wallet);
evidence.plan = plan.map((s) => s.title);
for (const [n, step] of plan.entries()) {
  const label2 = `${n + 2}. ${step.title}`;
  if (step.kind === "resolver") {
    const salt = resolverSalt(name, Date.now());
    resolver = await read<Address>(ENS.VerifiableFactory, factoryAbi, "predictProxyAddress", [dev.address, salt]);
    const tx = deployResolverTx(salt, resolverInitData(name, wallet, rootHex, new Date().toISOString()));
    await send(label2, tx.to, tx.data);
    const relayerRoles = await read<bigint>(resolver, resolverAbi, "roles", [0n, dev.address]);
    evidence.newResolver = resolver;
    evidence.relayerRolesOnNewResolver = relayerRoles;
    console.log(`   new resolver ${resolver}; roles the sender kept on it: ${relayerRoles}`);
  } else if (step.kind === "setResolver") await send(label2, ENS.ETHRegistry, setResolverData(await tokenId(), resolver!));
  else if (step.kind === "revoke") {
    const id = await tokenId();
    const resource = await read<bigint>(ENS.ETHRegistry, registryAbi, "getResource", [id]);
    const bitmap = await read<bigint>(ENS.ETHRegistry, registryAbi, "roles", [resource, step.account]);
    if (bitmap === 0n) console.log(`   ${step.account} holds no roles any more: skipped`);
    else await send(label2, ENS.ETHRegistry, revokeRolesData(id, bitmap, step.account));
  } else if (step.kind === "operator") await send(label2, ENS.ETHRegistry, removeOperatorData(step.account));
  else if (step.kind === "transfer") await send(label2, ENS.ETHRegistry, transferNameData(dev.address, wallet, await tokenId()));
}
const ownerNow = await read<Address>(ENS.ETHRegistry, registryAbi, "findOwner", [label]);
evidence.ownerAfter = ownerNow;
console.log(`owner of ${name} now ${ownerNow}`);
if (ownerNow.toLowerCase() !== wallet.toLowerCase()) throw new Error("the transfer didn't land");
}

// 7. the device signs a change, shown in words on its screen
info = await device.info();
if (await read<boolean>(wallet, pqWalletAbi, "isLeafUsed", [BigInt(info.next)])) throw new Error(`leaf ${info.next} is already used on the wallet`);
const value = `${new Date().toISOString()} signed on the hardware key`;
const calls = setTextCalls(resolver!, name, "pq.checked", value);
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const req = pqWalletRequest({ chainId: 11155111, wallet, leaf: info.next, deadline, calls });
const signed = await device.sign(info, levels, req, (leaf, attempt) =>
  console.log(`\n>>> The ESP32 shows the change (PQ WALLET · setText · name ${name} · key pq.checked). Read it, BOOT for each page, then BOOT to sign. (leaf ${leaf}, attempt ${attempt}) <<<\n`),
);
device.close();
console.log(`the device rebuilt the same hash and signed with leaf ${signed.leaf} ✓ (signature verified here)`);
await send(`7. the PQ wallet sets pq.checked (signed on the ESP32, leaf ${signed.leaf}; the dev wallet only relays)`, wallet, executeData(signed.leaf, deadline, calls, signed.witness), 1_500_000n);
evidence.deviceSigned = { leaf: signed.leaf, sigHash: req.sigHash, deviceHash: signed.deviceHash, record: { key: "pq.checked", value } };
save();

// 8. after
await new Promise((r) => setTimeout(r, 12_000));
const after = await check("after-hw", wallet);
evidence.after = { verdict: after.verdict, hijackablePaths: after.hijackablePaths, owner: after.owner, resolver: after.resolver, block: after.block };
evidence.finishedAt = new Date().toISOString();
save();

const dep = JSON.parse(readFileSync(repoPath("deployments", "sepolia.json"), "utf8"));
dep.hardwareName = { name, wallet, root: rootHex, resolver, evidence: `evidence/ens/hw-handover-${label}.json` };
dep.demoNames = [...new Set([...(dep.demoNames ?? []), name])];
writeFileSync(repoPath("deployments", "sepolia.json"), JSON.stringify(dep, null, 2) + "\n");
console.log(`\n${name}: ${before.verdict} (paths ${before.hijackablePaths.join(", ")}) -> ${after.verdict}; owner = the ESP32's PQ wallet ${wallet}`);
process.exit(after.verdict === "protected" ? 0 : 1);
