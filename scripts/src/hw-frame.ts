// A real EIP-8141 frame transaction signed by the ESP32 hardware signer (chain 1337).
//   1. read the device's public key (INFO) and its public Merkle tree (LEAVES, ~40 s), check the root
//   2. deploy (once) and fund a LifeboatAccount for that public key (CREATE2, deterministic)
//   3. build the transaction with the device's next leaf; the laptop grinds the counter (public work)
//   4. the device shows SIGN? and waits for the BOOT button; it saves its counter, then streams the chains
//   5. assemble + verify the witness here, dry-run, submit through the alt mempool, publish the leaf to Arkiv
// Usage: pnpm --filter @lifeboat/scripts hw-frame [--port COM5]
import { mkdirSync, writeFileSync } from "node:fs";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { concat, formatEther, getContractAddress, numberToHex, pad, parseEther, parseGwei, type Address, type Hex } from "viem";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import { encodeTx, frame, newTx, sigHash, type FrameTx } from "@forshtat/hegota-support/tx";
import { toWire } from "@forshtat/hegota-support/rpc";
import { authPath, encodeWitness, fromHex, grind, nodeHash, toHex, verify, LEAVES, TREE_HEIGHT, WITNESS_BYTES } from "@lifeboat/pq";
import { argValue, repoPath } from "./lib/env.js";
import { CREATE2_FACTORY, MINER_SIDECAR_URL, NODE_URL, devWallet, explorerTx, profile, publicClient, yulInitcode } from "./lib/devnet.js";
import { rpc } from "./lib/rpc.js";
import { EXPIRY, Leaf, arkivWallet } from "./lib/arkiv.js";

const portPath = argValue("--port") ?? "COM5";
const port = new SerialPort({ path: portPath, baudRate: 115200, hupcl: false, autoOpen: false });
await new Promise<void>((res, rej) => port.open((e) => (e ? rej(e) : res())));
await new Promise<void>((res) => port.set({ dtr: false, rts: false }, () => res()));
const lines = port.pipe(new ReadlineParser({ delimiter: "\n" }));
const waiters: ((l: string) => boolean)[] = [];
lines.on("data", (raw: string) => {
  const l = raw.trim();
  if (!l.startsWith("WOTS|")) return;
  for (let i = 0; i < waiters.length; i++) if (waiters[i]!(l)) waiters.splice(i--, 1);
});
const until = (pick: (l: string) => boolean, ms: number) =>
  new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("device timed out")), ms);
    waiters.push((l) => (pick(l) ? (clearTimeout(t), resolve(l), true) : false));
  });
const send = (l: string) => new Promise<void>((res) => port.write(l + "\n", () => res()));
await new Promise((r) => setTimeout(r, 1500)); // let the board settle if opening reset it

// 1. public key + tree
let p = until((l) => l.startsWith("WOTS|INFO|"), 10_000);
await send("WOTS|INFO");
const info = (await p).split("|");
if (info[2] === "NOKEY") throw new Error("the device has no key yet: generate one in the app first");
const next = Number(info[2]);
const pubSeed = fromHex("0x" + info[3]);
const root = fromHex("0x" + info[4]);
console.log(`device key root ${toHex(root)}, next leaf ${next}`);
console.log("reading the public tree from the device (~40 s)…");
const hashes: Uint8Array[] = new Array(LEAVES);
p = until((l) => {
  if (l.startsWith("WOTS|LH|")) {
    const [, , i, h] = l.split("|");
    hashes[Number(i)] = fromHex("0x" + h);
  }
  return l.startsWith("WOTS|ROOT|") || l.startsWith("WOTS|ERR|");
}, 10 * 60_000);
await send("WOTS|LEAVES");
await p;
const levels: Uint8Array[][] = [hashes];
for (let l = 1; l <= TREE_HEIGHT; l++) {
  const below = levels[l - 1]!;
  levels.push(Array.from({ length: below.length / 2 }, (_, i) => nodeHash(pubSeed, l, i, below[2 * i]!, below[2 * i + 1]!)));
}
if (toHex(levels[TREE_HEIGHT]![0]!) !== toHex(root)) throw new Error("rebuilt tree root doesn't match the device");
console.log("public tree rebuilt; root matches the device ✓");

// 2. the account for the device's key
const pub = publicClient();
const initcode = concat([yulInitcode("LifeboatAccount"), toHex(root), toHex(pubSeed)]);
const account = getContractAddress({ opcode: "CREATE2", from: CREATE2_FACTORY, salt: toHex(root), bytecode: initcode });
const { client } = devWallet();
if ((await pub.getCode({ address: account })) === undefined) {
  const gasPrice = ((await pub.getGasPrice()) * 12n) / 10n;
  const h = await client.sendTransaction({ to: CREATE2_FACTORY, data: concat([toHex(root), initcode]), gas: 10_000_000n, gasPrice, type: "legacy" });
  await pub.waitForTransactionReceipt({ hash: h, timeout: 180_000 });
  console.log(`deployed the device's account ${account} (${h})`);
}
if ((await pub.getBalance({ address: account })) < parseEther("0.005")) {
  const gasPrice = ((await pub.getGasPrice()) * 12n) / 10n;
  const h = await client.sendTransaction({ to: account, value: parseEther("0.01"), gas: 100_000n, gasPrice, type: "legacy" });
  await pub.waitForTransactionReceipt({ hash: h, timeout: 180_000 });
}
const [nonce, block] = await Promise.all([pub.getTransactionCount({ address: account }), pub.getBlock()]);
const floor = BigInt((await pub.getStorageAt({ address: account, slot: "0x2" })) ?? "0x1");
if (BigInt(next) + 1n < floor) throw new Error(`device leaf ${next} is below the account's on-chain floor ${floor - 1n}`);
console.log(`account ${account}: ${formatEther(await pub.getBalance({ address: account }))} ETH, nonce ${nonce}`);

// 3. the transaction (the leaf goes into the SENDER frame, so the account raises its floor)
const to: Address = client.account.address;
const value = parseEther("0.001");
const tx: FrameTx = newTx({
  chainId: 1337n,
  sender: account,
  nonceSeq: BigInt(nonce),
  frames: [
    frame(profile, "VERIFY", { execution: 60_000n, scope: "EXECUTION_AND_PAYMENT", data: "0x03" }),
    frame(profile, "SENDER", { execution: 80_000n, state: 200_000n, data: concat([pad(numberToHex(next), { size: 32 }), pad(to, { size: 32 }), pad(numberToHex(value), { size: 32 })]) }),
  ],
  signatures: [{ scheme: 0, signer: "0x", msg: "0x", signature: "0x" }],
  fees: { maxFeePerGas: (block.baseFeePerGas ?? parseGwei("1")) * 2n + parseGwei("1"), maxPriorityFeePerGas: parseGwei("1") },
});
const sh = sigHash(profile, tx);
const g = grind({ root, pubSeed }, next, fromHex(sh));
console.log(`sigHash ${sh}; counter ${g.counter} found in ${g.tries} tries on this laptop`);

// 4. the device signs (after the BOOT button)
const sigs: Uint8Array[] = new Array(64);
let doneLeaf = -1;
p = until((l) => {
  if (l.startsWith("WOTS|ASK|")) console.log(`\n>>> The ESP32 shows SIGN? for leaf ${l.split("|")[2]}. Press the BOOT button now. <<<\n`);
  if (l.startsWith("WOTS|SIG|")) {
    const [, , k, h] = l.split("|");
    sigs[Number(k!.split("/")[0]) - 1] = fromHex("0x" + h);
  }
  if (l.startsWith("WOTS|DONE|")) doneLeaf = Number(l.split("|")[2]);
  return l.startsWith("WOTS|DONE|") || l.startsWith("WOTS|ERR|");
}, 90_000);
await send(`WOTS|SIGN|${sh}|${g.counter}|1337 send 0.001 ETH`);
const end = await p;
port.close();
if (end.startsWith("WOTS|ERR|")) throw new Error(`device refused: ${end}`);
if (doneLeaf !== next) throw new Error(`device signed leaf ${doneLeaf}, expected ${next}`);

// 5. assemble, verify, submit
const witness = encodeWitness({ leaf: doneLeaf, counter: g.counter, sigs, path: authPath(levels, doneLeaf) });
if (!verify({ root, pubSeed }, fromHex(sh), witness) || witness.length !== WITNESS_BYTES) throw new Error("device signature does not verify");
console.log("device signature verified here ✓");
const signed: FrameTx = { ...tx, signatures: [{ scheme: 0, signer: "0x", msg: "0x", signature: toHex(witness) }] };
const sim = await rpc<any>(NODE_URL(), "ethrex_simulateFrameTransaction", [encodeTx(profile, signed), "latest", { trace: false }]);
console.log(`dry run: frames ${JSON.stringify(sim.frames?.map((f: any) => f.succeeded))}, VERIFY gas ${parseInt(sim.frames?.[0]?.gasUsed ?? "0x0", 16)}`);
const hash = await rpc<Hex>(MINER_SIDECAR_URL(), "eth_sendFrameTransaction", [toWire(signed)], { retries: 1 });
let receipt: any = null;
for (let i = 0; i < 40 && !receipt; i++) {
  receipt = await rpc(NODE_URL(), "eth_getTransactionReceipt", [hash]).catch(() => null);
  if (!receipt) await new Promise((r) => setTimeout(r, 3000));
}
console.log(`HARDWARE-SIGNED TX ${receipt ? `INCLUDED in block ${BigInt(receipt.blockNumber)}, status ${receipt.status}` : "submitted"}: ${hash}\n${explorerTx(hash)}`);

const { client: arkiv } = arkivWallet();
const leafEntity = await arkiv.executeBatch({
  creates: [{ schema: Leaf, values: { root: toHex(root), leaf: u64(BigInt(doneLeaf)), account: addr(account), chainId: u64(1337n), digest: sh, txHash: hash }, expiration: EXPIRY.leaf(), flags: { readonly: true, permissionlessExtension: true } }] as any,
});
mkdirSync(repoPath("evidence", "hardware"), { recursive: true });
writeFileSync(
  repoPath("evidence", "hardware", "esp32-frame-tx.json"),
  JSON.stringify({ device: "ESP32 DevKit V1 (CP2102)", port: portPath, root: toHex(root), pubSeed: toHex(pubSeed), account, leaf: doneLeaf, counter: g.counter, grindTries: g.tries, sigHash: sh, txHash: hash, explorer: explorerTx(hash), receipt, simulation: { frames: sim.frames }, arkivLeafTx: leafEntity.txHash, at: new Date().toISOString() }, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2),
);
console.log(`leaf ${doneLeaf} published to the Arkiv ledger (${leafEntity.txHash}); evidence/hardware/esp32-frame-tx.json saved`);
process.exit(0);
