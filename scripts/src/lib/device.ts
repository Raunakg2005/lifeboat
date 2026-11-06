// Node client for the ESP32 signer (firmware/esp32/lifeboat_signer): open the port without resetting the board,
// read its public key and tree, and get clear-signed WOTS+C witnesses for requests built in packages/core/src/device.ts.
// The host only ever holds public data; every witness is verified here before it is used.
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { authPath, encodeWitness, fromHex, grind, nodeHash, toHex, verify, LEAVES, TREE_HEIGHT, WITNESS_BYTES } from "@lifeboat/pq";
import type { DeviceRequest } from "@lifeboat/core";

export type DeviceInfo = { next: number; pubSeed: Uint8Array; root: Uint8Array; pinSet: boolean; locked: boolean };
const pinHex = (pin: string) => Buffer.from(pin, "utf8").toString("hex");

export async function openDevice(portPath = "COM5") {
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
  await new Promise((r) => setTimeout(r, 1200));

  async function info(): Promise<DeviceInfo> {
    const p = until((l) => l.startsWith("WOTS|INFO|"), 10_000);
    await send("WOTS|INFO");
    const parts = (await p).split("|");
    if (parts[2] === "NOKEY") throw new Error("the device has no key yet");
    return { next: Number(parts[2]), pubSeed: fromHex("0x" + parts[3]), root: fromHex("0x" + parts[4]), pinSet: parts.includes("pin=1"), locked: parts.includes("locked=1") };
  }

  /** Unlocks a PIN-locked device (the PIN goes over USB to the device only; it is never printed or saved here). */
  async function unlock(pin: string) {
    const p = until((l) => l === "WOTS|UNLOCKED" || l.startsWith("WOTS|ERR|"), 15 * 60_000);
    await send(`WOTS|UNLOCK|${pinHex(pin)}`);
    const r = await p;
    if (r !== "WOTS|UNLOCKED") throw new Error(r.startsWith("WOTS|ERR|bad-pin") ? `wrong PIN (${r.split("|")[3]} wrong in a row; waits grow after 3)` : `unlock refused: ${r.slice(9)}`);
  }
  /** Unlocks with DEVICE_PIN from the environment if the device is locked. */
  async function ensureUnlocked(i: DeviceInfo) {
    if (!i.locked) return i;
    const pin = process.env.DEVICE_PIN;
    if (!pin) throw new Error("the device is PIN-locked: put DEVICE_PIN=<your PIN> in .env");
    await unlock(pin);
    return info();
  }
  /** Sets (or changes) the PIN: the device asks for BOOT first. */
  async function setPin(pin: string, onAsk: () => void) {
    const p = until((l) => {
      if (l.startsWith("WOTS|ASK|")) onAsk();
      return l === "WOTS|PINSET" || l.startsWith("WOTS|ERR|");
    }, 150_000);
    await send(`WOTS|SETPIN|${pinHex(pin)}`);
    const r = await p;
    if (r !== "WOTS|PINSET") throw new Error(`PIN not set: ${r.slice(9)}`);
  }
  async function lock() {
    const p = until((l) => l === "WOTS|LOCKED" || l.startsWith("WOTS|ERR|"), 10_000);
    await send("WOTS|LOCK");
    return p;
  }
  /** Sends one raw line and returns the first WOTS|ERR / WOTS|ASK / WOTS|HASH reply (for refusal checks). */
  async function raw(line: string) {
    const p = until((l) => l.startsWith("WOTS|ERR|") || l.startsWith("WOTS|ASK|") || l.startsWith("WOTS|HASH|"), 20_000);
    await send(line);
    return p;
  }

  /** The public Merkle tree, rebuilt here and checked against the device's root (memory only). */
  async function tree(i: DeviceInfo): Promise<Uint8Array[][]> {
    const hashes: Uint8Array[] = new Array(LEAVES);
    const p = until((l) => {
      if (l.startsWith("WOTS|LH|")) {
        const [, , k, h] = l.split("|");
        hashes[Number(k)] = fromHex("0x" + h);
      }
      return l.startsWith("WOTS|ROOT|") || l.startsWith("WOTS|ERR|");
    }, 10 * 60_000);
    await send("WOTS|LEAVES");
    await p;
    const levels: Uint8Array[][] = [hashes];
    for (let l = 1; l <= TREE_HEIGHT; l++) {
      const below = levels[l - 1]!;
      levels.push(Array.from({ length: below.length / 2 }, (_, k) => nodeHash(i.pubSeed, l, k, below[2 * k]!, below[2 * k + 1]!)));
    }
    if (toHex(levels[TREE_HEIGHT]![0]!) !== toHex(i.root)) throw new Error("the public tree doesn't match the device root");
    return levels;
  }

  /**
   * Clear signing: sends the request itself, checks the hash the device rebuilt, waits for the person to read it and
   * press BOOT (asking again after a timeout, which uses no leaf), and returns a verified witness.
   */
  async function sign(i: DeviceInfo, levels: Uint8Array[][], req: DeviceRequest, onAsk: (leaf: number, attempt: number) => void, attempts = 6) {
    const pub = { root: i.root, pubSeed: i.pubSeed };
    const g = grind(pub, i.next, fromHex(req.sigHash));
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const sigs: Uint8Array[] = new Array(64);
      let deviceHash = "";
      let leaf = -1;
      const p = until((l) => {
        if (l.startsWith("WOTS|HASH|")) deviceHash = "0x" + l.split("|")[2];
        if (l.startsWith("WOTS|ASK|")) onAsk(Number(l.split("|")[2]), attempt);
        if (l.startsWith("WOTS|SIG|")) {
          const [, , k, h] = l.split("|");
          sigs[Number(k!.split("/")[0]) - 1] = fromHex("0x" + h);
        }
        if (l.startsWith("WOTS|DONE|")) leaf = Number(l.split("|")[2]);
        return l.startsWith("WOTS|DONE|") || l.startsWith("WOTS|ERR|");
      }, 150_000);
      await send(req.line(g.counter));
      const end = await p;
      if (end === "WOTS|ERR|timeout") continue;
      if (end === "WOTS|ERR|locked") throw new Error("the device is locked: unlock it with its PIN first");
      if (end.startsWith("WOTS|ERR|")) throw new Error(`device refused: ${end.slice(9)}`);
      if (deviceHash !== req.sigHash) throw new Error(`the device rebuilt ${deviceHash}, expected ${req.sigHash}`);
      if (leaf !== i.next) throw new Error(`device signed leaf ${leaf}, expected ${i.next}`);
      const witness = encodeWitness({ leaf, counter: g.counter, sigs, path: authPath(levels, leaf) });
      if (!verify(pub, fromHex(req.sigHash), witness) || witness.length !== WITNESS_BYTES) throw new Error("the device's signature does not verify");
      return { witness: toHex(witness) as `0x${string}`, leaf, counter: g.counter, tries: g.tries, deviceHash };
    }
    throw new Error("nobody pressed BOOT in time (no leaf used)");
  }

  return { info, tree, sign, unlock, ensureUnlocked, setPin, lock, raw, close: () => port.close() };
}
