// Clear signing on the real ESP32. Writes evidence/hardware/clear-signing.json.
//   1. refusals that need no button and must use no leaf: a bare hash, a wrong counter, a request for another leaf
//   2. one real signature: the device gets a message, rebuilds the hash itself, shows the text, and waits for BOOT;
//      the signature is verified here against the device's public tree, and the leaf counter must move by one
// Usage: pnpm --filter @lifeboat/scripts hw-clear-test [--port COM5]   (close any browser tab using the port first)
import { mkdirSync, writeFileSync } from "node:fs";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { keccak256 } from "viem";
import { authPath, digitSum, digitsOf, encodeWitness, fromHex, grind, messageDigest, nodeHash, toHex, verify, LEAVES, TARGET_SUM, TREE_HEIGHT, WITNESS_BYTES } from "@lifeboat/pq";
import { messageRequest, pqWalletRequest } from "@lifeboat/core";
import { argValue, repoPath } from "./lib/env.js";

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
const ask = async (line: string, ms = 10_000) => {
  const p = until((l) => l.startsWith("WOTS|ERR|") || l.startsWith("WOTS|ASK|") || l.startsWith("WOTS|INFO|"), ms);
  await send(line);
  return p;
};
await new Promise((r) => setTimeout(r, 1500));

const info = async () => {
  const parts = (await ask("WOTS|INFO")).split("|");
  if (parts[2] === "NOKEY") throw new Error("the device has no key");
  return { next: Number(parts[2]), pubSeed: fromHex("0x" + parts[3]), root: fromHex("0x" + parts[4]) };
};
{
  const p0 = until((l) => l.startsWith("WOTS|INFO|"), 10_000);
  await send("WOTS|INFO");
  const raw0 = (await p0).split("|");
  if (raw0.includes("locked=1")) {
    // PIN-locked: unlock with DEVICE_PIN from .env (sent over USB to the device only, never printed)
    const pin = process.env.DEVICE_PIN;
    if (!pin) throw new Error("the device is PIN-locked: put DEVICE_PIN=<your PIN> in .env");
    const u = until((l) => l === "WOTS|UNLOCKED" || l.startsWith("WOTS|ERR|"), 15 * 60_000);
    await send(`WOTS|UNLOCK|${Buffer.from(pin, "utf8").toString("hex")}`);
    const r = await u;
    if (r !== "WOTS|UNLOCKED") throw new Error(`unlock refused: ${r.slice(9)}`);
    console.log("device unlocked with its PIN");
  }
}
const before = await info();
console.log(`device key ${toHex(before.root).slice(0, 12)}…, next leaf ${before.next}`);

// the public tree (from the device's cache), so the signature can be checked here
const hashes: Uint8Array[] = new Array(LEAVES);
const treeDone = until((l) => {
  if (l.startsWith("WOTS|LH|")) {
    const [, , i, h] = l.split("|");
    hashes[Number(i)] = fromHex("0x" + h);
  }
  return l.startsWith("WOTS|ROOT|") || l.startsWith("WOTS|ERR|");
}, 10 * 60_000);
await send("WOTS|LEAVES");
await treeDone;
const levels: Uint8Array[][] = [hashes];
for (let l = 1; l <= TREE_HEIGHT; l++) {
  const below = levels[l - 1]!;
  levels.push(Array.from({ length: below.length / 2 }, (_, i) => nodeHash(before.pubSeed, l, i, below[2 * i]!, below[2 * i + 1]!)));
}
if (toHex(levels[TREE_HEIGHT]![0]!) !== toHex(before.root)) throw new Error("the public tree doesn't match the device root");

// 1. refusals
const pub = { root: before.root, pubSeed: before.pubSeed };
const msg = messageRequest(`Lifeboat clear-signing test ${new Date().toISOString()}`);
const good = grind(pub, before.next, fromHex(msg.sigHash));
let wrong = good.counter + 1;
while (digitSum(digitsOf(messageDigest(before.pubSeed, before.next, before.root, fromHex(msg.sigHash), wrong))) === TARGET_SUM) wrong++;
const refusals = [
  { name: "a bare hash", line: `WOTS|SIGN|${keccak256("0x01").slice(2)}|0|label`, expect: "blind-signing-off" },
  { name: "a counter that doesn't match the device's own digest", line: msg.line(wrong), expect: "bad-counter" },
  {
    name: "a PQ wallet request naming another leaf",
    line: pqWalletRequest({ chainId: 11155111, wallet: "0x2e58b0f2336dfe76b8bbab1bfd927e354cbc997f", leaf: before.next + 7, deadline: 1794000000n, calls: [{ target: "0xbac277e47dd7b95c04bb3517b76c1dd9151a054a", value: 1n, data: "0x" }] }).line(0),
    expect: "leaf-mismatch",
  },
];
const results: { name: string; reply: string; ok: boolean }[] = [];
for (const r of refusals) {
  const reply = await ask(r.line);
  const ok = reply === `WOTS|ERR|${r.expect}`;
  results.push({ name: r.name, reply, ok });
  console.log(`${ok ? "✅" : "❌"} refuses ${r.name}: ${reply}`);
}
const mid = await info();
const noLeafUsed = mid.next === before.next;
console.log(`${noLeafUsed ? "✅" : "❌"} no leaf used by the refusals (next leaf still ${mid.next})`);

// 2. one real signature (retries if nobody presses in time: a timeout uses no leaf)
const sigs: Uint8Array[] = new Array(64);
let deviceHash = "";
let doneLeaf = -1;
let end = "";
for (let attempt = 1; attempt <= 6 && !end.startsWith("WOTS|DONE|"); attempt++) {
  const p = until((l) => {
    if (l.startsWith("WOTS|HASH|")) deviceHash = "0x" + l.split("|")[2];
    if (l.startsWith("WOTS|ASK|")) console.log(`\n>>> The ESP32 shows the message (leaf ${l.split("|")[2]}). Read it, then press BOOT to sign. (attempt ${attempt}/6) <<<\n`);
    if (l.startsWith("WOTS|SIG|")) {
      const [, , k, h] = l.split("|");
      sigs[Number(k!.split("/")[0]) - 1] = fromHex("0x" + h);
    }
    if (l.startsWith("WOTS|DONE|")) doneLeaf = Number(l.split("|")[2]);
    return l.startsWith("WOTS|DONE|") || l.startsWith("WOTS|ERR|");
  }, 150_000);
  await send(msg.line(good.counter));
  end = await p;
  if (end !== "WOTS|ERR|timeout") break;
  console.log("nobody pressed BOOT in time (no leaf used); asking again");
}
const after = await info();
port.close();
if (!end.startsWith("WOTS|DONE|")) throw new Error(`no signature: ${end}`);
const witness = encodeWitness({ leaf: doneLeaf, counter: good.counter, sigs, path: authPath(levels, doneLeaf) });
const checks = {
  refusals: results.every((r) => r.ok),
  noLeafUsedByRefusals: noLeafUsed,
  deviceRebuiltTheSameHash: deviceHash === msg.sigHash,
  signatureVerifies: verify(pub, fromHex(msg.sigHash), witness) && witness.length === WITNESS_BYTES,
  signedWithItsNextLeaf: doneLeaf === before.next,
  counterMovedByOne: after.next === before.next + 1,
};
for (const [k, v] of Object.entries(checks)) console.log(`${v ? "✅" : "❌"} ${k}`);
mkdirSync(repoPath("evidence", "hardware"), { recursive: true });
writeFileSync(
  repoPath("evidence", "hardware", "clear-signing.json"),
  JSON.stringify({ device: "ESP32 DevKit V1", port: portPath, root: toHex(before.root), message: msg.line(0).split("|")[3], sigHash: msg.sigHash, deviceHash, leaf: doneLeaf, counter: good.counter, refusals: results, checks, at: new Date().toISOString() }, null, 2),
);
const passed = Object.values(checks).every(Boolean);
console.log(passed ? "PASSED: clear signing works on the device" : "FAILED");
process.exit(passed ? 0 : 1);
