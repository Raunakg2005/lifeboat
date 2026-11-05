// Writes contracts/test/vectors/wallet.json: WOTS+C-signed LifeboatPQWallet.execute calls, made by the
// TypeScript signer for a wallet at a fixed address on chain 31337, so Foundry tests the real flow.
import { mkdirSync, writeFileSync } from "node:fs";
import type { Address } from "viem";
import { fromHex, generateKeyPair, sign, toHex } from "@lifeboat/pq";
import { repoPath } from "./lib/env.js";
import { walletDigest, type Call } from "./lib/pqwallet.js";

const WALLET: Address = "0x0000000000000000000000000000000000001ce0";
const key = generateKeyPair(new Uint8Array(32).fill(0x33), new Uint8Array(32).fill(0x44));
const recipient: Address = "0x000000000000000000000000000000000000bEEF";
const deadline = 4_000_000_000n;

const cases = [3n, 200n].map((leaf) => {
  const calls: Call[] = [{ target: recipient, value: 1000n, data: "0x" }];
  const d = walletDigest(31337n, WALLET, leaf, deadline, calls);
  return { leaf: Number(leaf), deadline: deadline.toString(), recipient, value: "1000", digest: d, witness: toHex(sign(key, Number(leaf), fromHex(d)).witness) };
});
mkdirSync(repoPath("contracts", "test", "vectors"), { recursive: true });
writeFileSync(repoPath("contracts", "test", "vectors", "wallet.json"), JSON.stringify({ wallet: WALLET, chainId: 31337, root: toHex(key.root), pubSeed: toHex(key.pubSeed), cases }, null, 2));
console.log(`wrote ${cases.length} wallet vectors for ${WALLET}`);
