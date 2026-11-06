// Quantum Guard, live on a real Safe 1.4.1 on Sepolia.
//
//  1. Create a 1-of-1 Safe owned by the dev wallet (an exposed ECDSA key: it stands in for a council whose keys a
//     quantum computer can forge). Fund it with a little Sepolia ETH.
//  2. Before: with Safe's standard fallback handler, the owner's ECDSA signature alone makes an ERC-1271 signature
//     for the Safe valid (the Permit2 / CoW-order path).
//  3. Deploy QuantumGuard (the "guard" WOTS+C key) and install it: setGuard (owners only, nothing guards yet), then
//     setFallbackHandler(guard), the first transaction that needs the post-quantum co-signature.
//  4. Attack: the owner's signature alone, paying an attacker. Refused on-chain by the guard.
//  5. The same payment co-signed with the post-quantum key: included.
//  6. ERC-1271 after: the owner's signature alone is refused; after the PQ key approves the message, it's valid.
// Every leaf is reserved and saved before it signs (scripts/src/lib/pqkey.ts). Nothing here reuses a leaf.
// Usage: pnpm --filter @lifeboat/scripts quantum-guard
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { concat, decodeErrorResult, encodeAbiParameters, encodeFunctionData, formatEther, keccak256, parseAbi, parseEther, toBytes, type Address, type Hex } from "viem";
import { fromHex, sign, toHex } from "@lifeboat/pq";
import { repoPath } from "./lib/env.js";
import { forgeBytecode } from "./lib/deployments.js";
import { sepoliaClient, sepoliaDevWallet, withStaleRetry } from "./lib/ens.js";
import { KIND, guardDigest, safeMessageData, safeTxHash, type SafeTx } from "./lib/guard.js";
import { loadOrCreateKey, reserveLeaf, saveKeyFile } from "./lib/pqkey.js";

const SAFE_141 = { singleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a", factory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67", fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99" } as const;
const GUARD_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8"; // keccak256("guard_manager.guard.address")
const HANDLER_SLOT = "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5"; // keccak256("fallback_manager.handler.address")
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

const safeAbi = parseAbi([
  "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
  "function nonce() view returns (uint256)",
  "function setGuard(address guard)",
  "function setFallbackHandler(address handler)",
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
]);
const factoryAbi = parseAbi(["function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)"]);
const guardAbi = parseAbi([
  "function approveMessage(bytes32 dataHash, bytes witness)",
  "function isLeafUsed(uint256 leaf) view returns (bool)",
  "function root() view returns (bytes32)",
  "error NotTheSafe()",
  "error MissingPQSignature()",
  "error LeafOutOfRange(uint256 leaf)",
  "error LeafUsed(uint256 leaf)",
  "error BadPQSignature()",
]);

const statePath = repoPath("deployments", "sepolia.json");
const state: Record<string, any> = JSON.parse(readFileSync(statePath, "utf8"));
state.quantumGuard ??= { txs: {} };
const g = state.quantumGuard;
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
const evidence: Record<string, any> = { chainId: 11155111, startedAt: new Date().toISOString(), steps: [] };

const pub = sepoliaClient();
const { account: owner, client } = sepoliaDevWallet();
console.log(`owner (exposed ECDSA key) ${owner.address}: ${formatEther(await pub.getBalance({ address: owner.address }))} Sepolia ETH`);

async function send(what: string, req: { to?: Address; data?: Hex; value?: bigint; gas?: bigint }, expectFail = false) {
  const hash = await withStaleRetry(() => client.sendTransaction({ to: req.to ?? null, data: req.data, value: req.value, gas: req.gas } as any));
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 300_000 });
  if ((r.status === "success") === expectFail) throw new Error(`${what}: unexpected status ${r.status} (${hash})`);
  g.txs[what] = hash;
  save();
  console.log(`${r.status === "success" ? "✅" : "❌ (as intended)"} ${what}: ${hash} (block ${r.blockNumber}, gas ${r.gasUsed})`);
  evidence.steps.push({ what, hash, block: r.blockNumber.toString(), status: r.status, gasUsed: r.gasUsed.toString() });
  return r;
}

// 1. the Safe
if (!g.safe) {
  const initializer = encodeFunctionData({ abi: safeAbi, functionName: "setup", args: [[owner.address], 1n, ZERO, "0x", SAFE_141.fallbackHandler, ZERO, 0n, ZERO] });
  const salt = BigInt(Date.now());
  const { result } = await pub.simulateContract({ account: owner, address: SAFE_141.factory, abi: factoryAbi, functionName: "createProxyWithNonce", args: [SAFE_141.singleton, initializer, salt] });
  await send("create Safe 1.4.1 (1-of-1, owner = exposed dev wallet)", { to: SAFE_141.factory, data: encodeFunctionData({ abi: factoryAbi, functionName: "createProxyWithNonce", args: [SAFE_141.singleton, initializer, salt] }) });
  g.safe = result;
  save();
}
const safe = g.safe as Address;
console.log(`Safe ${safe}`);
if ((await pub.getBalance({ address: safe })) < parseEther("0.002")) await send("fund the Safe (0.003 ETH)", { to: safe, value: parseEther("0.003") });

const safeTx = async (to: Address, value: bigint, data: Hex): Promise<SafeTx> => ({ to, value, data, operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: (await pub.readContract({ address: safe, abi: safeAbi, functionName: "nonce" })) as bigint });
const ownerSig = async (h: Hex) => (await owner.sign({ hash: h })) as Hex; // v 27/28: an ordinary ECDSA owner signature
const execData = (t: SafeTx, signatures: Hex) =>
  encodeFunctionData({ abi: safeAbi, functionName: "execTransaction", args: [t.to, t.value, t.data, t.operation, t.safeTxGas, t.baseGas, t.gasPrice, t.gasToken, t.refundReceiver, signatures] });
const readSlot = async (slot: Hex) => `0x${((await pub.getStorageAt({ address: safe, slot })) ?? "0x").slice(-40)}`.toLowerCase();

// the ERC-1271 test message: a stand-in for a Permit2 permit the Safe is asked to sign
const dataHash = keccak256(toBytes(`Lifeboat demo: a Permit2 permit for Safe ${safe}`));
const messageHash = keccak256(safeMessageData(11155111, safe, dataHash));
const msgSig = await ownerSig(messageHash);
const is1271 = async () => (await pub.readContract({ address: safe, abi: safeAbi, functionName: "isValidSignature", args: [dataHash, msgSig] }).catch(() => "0xrevert")) as string;

// 2. before
if (!g.guard) {
  const before = await is1271();
  console.log(`ERC-1271 before the guard, owner's signature alone: ${before} ${before === "0x1626ba7e" ? "(valid: a forged owner key could sign permits for this Safe)" : ""}`);
  evidence.erc1271Before = before;
}

// 3. the guard
const { file: key, key: pair } = loadOrCreateKey("guard"); // key = the file (leaf counter), pair = the WOTS+C key pair
if (!g.guard) {
  const args = encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }], [safe, state.verifier, key.root as Hex, key.pubSeed as Hex]);
  g.guard = (await send("deploy QuantumGuard (WOTS+C co-signer)", { data: concat([forgeBytecode("QuantumGuard.sol", "QuantumGuard"), args]) })).contractAddress;
  key.account = g.guard;
  saveKeyFile(key);
  save();
}
const guard = g.guard as Address;
console.log(`QuantumGuard ${guard} (PQ root ${key.root.slice(0, 18)}…)`);

const cosignTx = (h: Hex, purpose: string) => {
  const d = guardDigest(11155111, guard, safe, KIND.tx, h);
  const leaf = reserveLeaf(key, purpose, d);
  return { leaf, witness: toHex(sign(pair, leaf, fromHex(d)).witness) as Hex };
};

if ((await readSlot(GUARD_SLOT)) !== guard.toLowerCase()) {
  const t = await safeTx(safe, 0n, encodeFunctionData({ abi: safeAbi, functionName: "setGuard", args: [guard] }));
  await send("Safe tx: setGuard(QuantumGuard), owners only", { to: safe, data: execData(t, await ownerSig(safeTxHash(11155111, safe, t))) });
}
if ((await readSlot(HANDLER_SLOT)) !== guard.toLowerCase()) {
  const t = await safeTx(safe, 0n, encodeFunctionData({ abi: safeAbi, functionName: "setFallbackHandler", args: [guard] }));
  const h = safeTxHash(11155111, safe, t);
  const { leaf, witness } = cosignTx(h, "setFallbackHandler");
  await send(`Safe tx: setFallbackHandler(QuantumGuard), co-signed with PQ leaf ${leaf}`, { to: safe, data: execData(t, concat([await ownerSig(h), witness])) });
}

// 4. attack: the owner's signature alone (what a quantum attacker could forge)
const attacker = "0x000000000000000000000000000000000000dEaD" as Address;
{
  const t = await safeTx(attacker, parseEther("0.001"), "0x");
  const data = execData(t, await ownerSig(safeTxHash(11155111, safe, t)));
  let reason = "";
  try {
    await pub.call({ account: owner.address, to: safe, data });
  } catch (e: any) {
    const raw = (e?.data ?? e?.cause?.data ?? e?.walk?.((x: any) => x?.data)?.data) as Hex | undefined;
    try {
      reason = raw ? decodeErrorResult({ abi: guardAbi, data: raw }).errorName : String(e?.shortMessage ?? e).slice(0, 120);
    } catch {
      reason = String(e?.shortMessage ?? e).slice(0, 120);
    }
  }
  console.log(`attack simulated: refused with ${reason || "(no revert?)"}`);
  evidence.attackRevert = reason;
  await send("attack: pay 0.001 ETH to an attacker with the owner's ECDSA signature only", { to: safe, data, gas: 300_000n }, true);
}

// 5. the same kind of payment, co-signed
{
  const t = await safeTx(owner.address, parseEther("0.001"), "0x");
  const h = safeTxHash(11155111, safe, t);
  const { leaf, witness } = cosignTx(h, "pay 0.001 ETH to the treasury");
  await send(`pay 0.001 ETH to the treasury, co-signed with PQ leaf ${leaf}`, { to: safe, data: execData(t, concat([await ownerSig(h), witness])) });
}

// 6. ERC-1271 after
{
  const after = await is1271();
  console.log(`ERC-1271 with the guard as handler, owner's signature alone: ${after}`);
  evidence.erc1271AfterWithoutPQ = after;
  const d = guardDigest(11155111, guard, safe, KIND.message, messageHash);
  const leaf = reserveLeaf(key, "approve a Permit2 message", d);
  const witness = toHex(sign(pair, leaf, fromHex(d)).witness) as Hex;
  await send(`PQ key approves the message (leaf ${leaf}), relayed by anyone`, { to: guard, data: encodeFunctionData({ abi: guardAbi, functionName: "approveMessage", args: [dataHash, witness] }) });
  const approved = await is1271();
  console.log(`ERC-1271 after the PQ approval, owner's signature: ${approved}`);
  evidence.erc1271AfterWithPQ = approved;
}

evidence.safe = safe;
evidence.guard = guard;
evidence.pqRoot = key.root;
evidence.leavesUsed = key.nextLeaf;
evidence.finishedAt = new Date().toISOString();
mkdirSync(repoPath("evidence", "guard"), { recursive: true });
const prev = existsSync(repoPath("evidence", "guard", "quantum-guard.json")) ? JSON.parse(readFileSync(repoPath("evidence", "guard", "quantum-guard.json"), "utf8")) : null;
writeFileSync(repoPath("evidence", "guard", "quantum-guard.json"), JSON.stringify(prev ? { ...prev, rerun: evidence } : evidence, null, 2));
console.log("wrote evidence/guard/quantum-guard.json");
