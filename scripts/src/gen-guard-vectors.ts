// Writes contracts/test/vectors/guard.json: WOTS+C co-signatures made by the TypeScript signer for a QuantumGuard
// on a test Safe (chain 31337, fixed addresses), so the Foundry tests run the real signatures.
import { mkdirSync, writeFileSync } from "node:fs";
import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from "viem";
import { fromHex, generateKeyPair, sign, toHex } from "@lifeboat/pq";
import { repoPath } from "./lib/env.js";
import { KIND, cancelRecoveryHash, guardDigest, safeMessageData, safeTxHash, type SafeTx } from "./lib/guard.js";

const CHAIN = 31337;
const SAFE: Address = "0x0000000000000000000000000000000000005afe";
const GUARD: Address = "0x0000000000000000000000000000000000009a2d";
const ZERO: Address = "0x0000000000000000000000000000000000000000";
const key = generateKeyPair(new Uint8Array(32).fill(0x55), new Uint8Array(32).fill(0x66));
const next = generateKeyPair(new Uint8Array(32).fill(0x77), new Uint8Array(32).fill(0x88));

const tx = (nonce: bigint): SafeTx => ({ to: "0x000000000000000000000000000000000000beef", value: 1000n, data: "0x", operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce });
const cosign = (kind: number, h: Hex, leaf: number) => toHex(sign(key, leaf, fromHex(guardDigest(CHAIN, GUARD, SAFE, kind, h))).witness);

const txCase = (name: string, nonce: bigint, leaf: number) => {
  const h = safeTxHash(CHAIN, SAFE, tx(nonce));
  return { name, nonce: Number(nonce), leaf, safeTxHash: h, witness: cosign(KIND.tx, h, leaf) };
};

const dataHash = keccak256(toBytes("a Permit2 permit the Safe is asked to sign"));
const messageHash = keccak256(safeMessageData(CHAIN, SAFE, dataHash));
const rotateHash = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [toHex(next.root) as Hex, toHex(next.pubSeed) as Hex]));

const out = {
  chainId: CHAIN,
  safe: SAFE,
  guard: GUARD,
  root: toHex(key.root),
  pubSeed: toHex(key.pubSeed),
  recipient: tx(0n).to,
  value: "1000",
  tx: [txCase("nonce 0, leaf 7", 0n, 7), txCase("nonce 1, leaf 7 again (deliberate reuse)", 1n, 7), txCase("nonce 1, leaf 8", 1n, 8)],
  message: { dataHash, messageHash, leaf: 9, witness: cosign(KIND.message, messageHash, 9) },
  rotate: { newRoot: toHex(next.root), newPubSeed: toHex(next.pubSeed), leaf: 10, witness: cosign(KIND.rotate, rotateHash, 10) },
  cancelRecovery: { nonce: 1, leaf: 11, witness: cosign(KIND.cancelRecovery, cancelRecoveryHash(1n), 11) },
  recoveryDelay: 7 * 24 * 3600,
};
mkdirSync(repoPath("contracts", "test", "vectors"), { recursive: true });
writeFileSync(repoPath("contracts", "test", "vectors", "guard.json"), JSON.stringify(out, null, 2));
console.log(`wrote guard vectors: ${out.tx.length} transactions, 1 message, 1 rotation, 1 recovery veto`);
