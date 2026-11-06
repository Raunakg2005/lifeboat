// Quantum Guard against a real Uniswap Permit2 permit, on Sepolia.
//
// Permit2 checks a contract owner's signature with ERC-1271: it calls Safe.isValidSignature(digest, signature), which
// the Safe forwards to its fallback handler, here QuantumGuard. So a permit "signed by the Safe" needs the owners'
// signatures AND a post-quantum approval of that exact message.
//
//  1. Checks (nothing is sent if one fails): Permit2 and USDC deployed, Permit2's EIP-712 domain separator matches
//     ours, QuantumGuard is the Safe's fallback handler, no recovery has completed, the guard key is the guard's.
//  2. The Safe owners sign a real PermitSingle (1 USDC allowance for the dev wallet, Sepolia USDC).
//  3. Refused: Permit2.permit with the owners' signature only reverts on-chain (InvalidContractSignature).
//  4. The PQ key approves the message (QuantumGuard.approveMessage, relayed by anyone; the leaf is saved first).
//  5. Accepted: the same Permit2.permit call now succeeds, and Permit2.allowance(Safe, USDC, spender) shows it.
// The Safe and guard come from `pnpm --filter @lifeboat/scripts quantum-guard` (deployments/sepolia.json).
// Usage: pnpm --filter @lifeboat/scripts guard-permit2
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { decodeErrorResult, encodeAbiParameters, encodeFunctionData, formatEther, hashTypedData, keccak256, parseAbi, parseAbiParameters, toBytes, type Address, type Hex } from "viem";
import { fromHex, sign, toHex } from "@lifeboat/pq";
import { repoPath } from "./lib/env.js";
import { sepoliaClient, sepoliaDevWallet, withStaleRetry } from "./lib/ens.js";
import { KIND, guardDigest, safeMessageData } from "./lib/guard.js";
import { keyPath, loadOrCreateKey, reserveLeaf } from "./lib/pqkey.js";

const CHAIN = 11155111;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address; // Uniswap's canonical Permit2 (same on every chain)
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as Address; // Circle's USDC on Sepolia
const HANDLER_SLOT = "0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5"; // keccak256("fallback_manager.handler.address")

const permit2Abi = parseAbi([
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "struct PermitDetails { address token; uint160 amount; uint48 expiration; uint48 nonce; }",
  "struct PermitSingle { PermitDetails details; address spender; uint256 sigDeadline; }",
  "function permit(address owner, PermitSingle permitSingle, bytes signature)",
  "error InvalidContractSignature()",
  "error InvalidSignature()",
  "error InvalidSigner()",
  "error InvalidSignatureLength()",
  "error SignatureExpired(uint256 signatureDeadline)",
  "error InvalidNonce()",
]);
const safeAbi = parseAbi(["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)", "function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)"]);
const guardAbi = parseAbi(["function approveMessage(bytes32 dataHash, bytes witness)", "function recovered() view returns (bool)", "function root() view returns (bytes32)", "function safe() view returns (address)"]);
const erc20Abi = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);

const state: Record<string, any> = JSON.parse(readFileSync(repoPath("deployments", "sepolia.json"), "utf8"));
const safe = state.quantumGuard?.safe as Address;
const guard = state.quantumGuard?.guard as Address;
if (!safe || !guard) throw new Error("no Quantum Guard Safe in deployments/sepolia.json: run quantum-guard first");

const pub = sepoliaClient();
const { account: owner, client } = sepoliaDevWallet();
const evidence: Record<string, any> = { chainId: CHAIN, startedAt: new Date().toISOString(), permit2: PERMIT2, token: USDC, safe, guard, steps: [] };

async function send(what: string, req: { to: Address; data: Hex; gas?: bigint }, expectFail = false) {
  const hash = await withStaleRetry(() => client.sendTransaction({ to: req.to, data: req.data, gas: req.gas } as any));
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 300_000 });
  if ((r.status === "success") === expectFail) throw new Error(`${what}: unexpected status ${r.status} (${hash})`);
  console.log(`${r.status === "success" ? "✅" : "❌ (as intended)"} ${what}: ${hash} (block ${r.blockNumber}, gas ${r.gasUsed})`);
  evidence.steps.push({ what, hash, block: r.blockNumber.toString(), status: r.status, gasUsed: r.gasUsed.toString() });
  return r;
}
const revertName = async (data: Hex) => {
  try {
    await pub.call({ account: owner.address, to: PERMIT2, data });
    return "";
  } catch (e: any) {
    const raw = (e?.data ?? e?.cause?.data ?? e?.walk?.((x: any) => x?.data)?.data) as Hex | undefined;
    try {
      return raw ? decodeErrorResult({ abi: permit2Abi, data: raw }).errorName : String(e?.shortMessage ?? e).slice(0, 160);
    } catch {
      return String(e?.shortMessage ?? e).slice(0, 160);
    }
  }
};

// 1. checks, before anything is sent
const code = async (a: Address) => ((await pub.getCode({ address: a })) ?? "0x").length / 2 - 1;
const [p2Code, usdcCode] = await Promise.all([code(PERMIT2), code(USDC)]);
if (!p2Code || !usdcCode) throw new Error(`Permit2 (${p2Code} bytes) or USDC (${usdcCode} bytes) missing on Sepolia`);
const symbol = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "symbol" });
const decimals = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "decimals" });
const domainOnChain = await pub.readContract({ address: PERMIT2, abi: permit2Abi, functionName: "DOMAIN_SEPARATOR" });
const domainOurs = keccak256(
  encodeAbiParameters(parseAbiParameters("bytes32, bytes32, uint256, address"), [keccak256(toBytes("EIP712Domain(string name,uint256 chainId,address verifyingContract)")), keccak256(toBytes("Permit2")), BigInt(CHAIN), PERMIT2]),
);
if (domainOnChain !== domainOurs) throw new Error(`Permit2 domain separator mismatch: chain ${domainOnChain}, ours ${domainOurs}`);
const handler = `0x${((await pub.getStorageAt({ address: safe, slot: HANDLER_SLOT })) ?? "0x").slice(-40)}`.toLowerCase();
if (handler !== guard.toLowerCase()) throw new Error(`the Safe's fallback handler is ${handler}, not QuantumGuard ${guard}`);
// the first guard (this Safe's) predates the recovery path, so recovered() doesn't exist there: no recovery possible
const recovered = await pub.readContract({ address: guard, abi: guardAbi, functionName: "recovered" }).catch(() => "no recovery path in this guard version");
if (recovered === true) throw new Error("a recovery has completed: the owners act alone, so this would prove nothing");
if (!existsSync(keyPath("guard"))) throw new Error("the guard's PQ key file is missing (secrets/pq-key-guard.json): refusing to create a new key");
const { file: key, key: pair } = loadOrCreateKey("guard");
const onChainRoot = await pub.readContract({ address: guard, abi: guardAbi, functionName: "root" });
if (onChainRoot.toLowerCase() !== key.root.toLowerCase()) throw new Error(`guard root ${onChainRoot} is not the local guard key ${key.root}`);
const owners = await pub.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" });
const threshold = await pub.readContract({ address: safe, abi: safeAbi, functionName: "getThreshold" });
console.log(`Permit2 ${PERMIT2} (${p2Code} bytes, domain ✓) · ${symbol} ${USDC} · Safe ${safe} (${threshold}-of-${owners.length}) · QuantumGuard ${guard} (handler ✓, recovered: ${recovered}, root ✓, next leaf ${key.nextLeaf})`);
console.log(`owner / relayer ${owner.address}: ${formatEther(await pub.getBalance({ address: owner.address }))} Sepolia ETH`);

// 2. a real PermitSingle: the Safe lets the dev wallet spend 1 USDC through Permit2
const spender = owner.address;
const before = await pub.readContract({ address: PERMIT2, abi: permit2Abi, functionName: "allowance", args: [safe, USDC, spender] });
const now = BigInt(Math.floor(Date.now() / 1000));
const permit = {
  details: { token: USDC, amount: 10n ** BigInt(decimals), expiration: Number(now + 30n * 86400n), nonce: Number(before[2]) },
  spender,
  sigDeadline: now + 2n * 3600n,
};
const permitDigest = hashTypedData({
  domain: { name: "Permit2", chainId: CHAIN, verifyingContract: PERMIT2 },
  types: {
    PermitDetails: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
    PermitSingle: [
      { name: "details", type: "PermitDetails" },
      { name: "spender", type: "address" },
      { name: "sigDeadline", type: "uint256" },
    ],
  },
  primaryType: "PermitSingle",
  message: permit,
});
// the Safe's own ERC-1271 message for that digest, signed by the owner (what a quantum attacker could forge)
const messageHash = keccak256(safeMessageData(CHAIN, safe, permitDigest));
const ownerSig = (await owner.sign({ hash: messageHash })) as Hex;
const permitCall = encodeFunctionData({ abi: permit2Abi, functionName: "permit", args: [safe, permit, ownerSig] });
evidence.permit = { ...permit, details: { ...permit.details, amount: permit.details.amount.toString() }, sigDeadline: permit.sigDeadline.toString() };
evidence.permitDigest = permitDigest;
evidence.safeMessageHash = messageHash;
evidence.allowanceBefore = { amount: before[0].toString(), expiration: before[1], nonce: before[2] };
console.log(`PermitSingle: ${symbol} 1.00 to ${spender} until ${new Date(permit.details.expiration * 1000).toISOString()} (nonce ${permit.details.nonce}) · EIP-712 digest ${permitDigest}`);

// 3. refused: the owners' signature only
const is1271Before = (await pub.readContract({ address: safe, abi: safeAbi, functionName: "isValidSignature", args: [permitDigest, ownerSig] }).catch(() => "0xrevert")) as string;
const reasonBefore = await revertName(permitCall);
console.log(`Safe.isValidSignature with the owner's signature only: ${is1271Before} · Permit2.permit simulated: ${reasonBefore || "(no revert?)"}`);
if (!reasonBefore) throw new Error("Permit2 accepted the owners-only signature: the guard is not protecting this path");
evidence.erc1271OwnersOnly = is1271Before;
evidence.permitRevertOwnersOnly = reasonBefore;
await send("Permit2.permit for the Safe with the owners' signature only", { to: PERMIT2, data: permitCall, gas: 200_000n }, true);

// 4. the PQ key approves this exact message (leaf reserved and saved before it signs)
const d = guardDigest(CHAIN, guard, safe, KIND.message, messageHash);
const leaf = reserveLeaf(key, `approve a real Permit2 permit (${symbol} 1.00 to ${spender}, nonce ${permit.details.nonce})`, d);
const witness = toHex(sign(pair, leaf, fromHex(d)).witness) as Hex;
const approveData = encodeFunctionData({ abi: guardAbi, functionName: "approveMessage", args: [permitDigest, witness] });
await pub.call({ account: owner.address, to: guard, data: approveData }); // throws (nothing sent) if the guard would refuse it
await send(`PQ key approves the Permit2 message (leaf ${leaf}), relayed by anyone`, { to: guard, data: approveData });
evidence.pqLeaf = leaf;

// 5. accepted: the same call, the same owner signature
const is1271After = (await pub.readContract({ address: safe, abi: safeAbi, functionName: "isValidSignature", args: [permitDigest, ownerSig] }).catch(() => "0xrevert")) as string;
console.log(`Safe.isValidSignature after the PQ approval: ${is1271After}`);
evidence.erc1271WithPQ = is1271After;
await send("Permit2.permit for the Safe, owners + post-quantum approval", { to: PERMIT2, data: permitCall });
const after = await pub.readContract({ address: PERMIT2, abi: permit2Abi, functionName: "allowance", args: [safe, USDC, spender] });
evidence.allowanceAfter = { amount: after[0].toString(), expiration: after[1], nonce: after[2] };
console.log(`Permit2.allowance(Safe, ${symbol}, spender): ${after[0]} (expires ${new Date(after[1] * 1000).toISOString()}, nonce ${after[2]})`);
if (after[0] !== permit.details.amount || after[2] !== before[2] + 1) throw new Error("the allowance didn't change as the permit says");

evidence.finishedAt = new Date().toISOString();
mkdirSync(repoPath("evidence", "guard"), { recursive: true });
writeFileSync(repoPath("evidence", "guard", "permit2.json"), JSON.stringify(evidence, null, 2));
console.log("wrote evidence/guard/permit2.json");
