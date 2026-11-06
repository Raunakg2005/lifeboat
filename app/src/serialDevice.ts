// Web Serial link to the ESP32 signer (firmware/esp32/lifeboat_signer), for flows that sign real requests.
// The browser holds only public data, in memory only (nothing is saved): the device's public tree, read on connect,
// and the counter it grinds. Every signature the device returns is checked here before anything is sent.
// Protocol: docs/hardware.md (115200 baud, every line starts with "WOTS|").
import { authPath, encodeWitness, fromHex, grind, nodeHash, toHex, verify, LEAVES, TREE_HEIGHT, WITNESS_BYTES } from "@lifeboat/pq";
import type { DeviceRequest } from "@lifeboat/core";
import type { Hex } from "viem";

export type DeviceInfo = { next: number; pubSeed: Hex; root: Hex };
export type SignedWitness = { leaf: number; counter: number; tries: number; witness: Hex };

// minimal Web Serial typing (not in every TS DOM lib)
type SerialPortLike = {
  open(o: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
  setSignals?(s: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};
type SerialLike = { requestPort(): Promise<SerialPortLike> };

export const serialSupported = () => typeof navigator !== "undefined" && "serial" in navigator;

/** The device's WOTS|ERR reasons, in plain words. */
const REASONS: Record<string, string> = {
  "leaf-mismatch": "The device's counter moved: reconnect it.",
  timeout: "Nobody pressed BOOT in time. Nothing was signed and no leaf was used.",
  rejected: "Rejected on the device. Nothing was signed and no leaf was used.",
  "bad-counter": "The device didn't accept the counter: reconnect it and try again. No leaf was used.",
  "no-key": "The device has no key yet. Create one with the hardware signer on the Escape tab.",
  exhausted: "All 256 one-time leaves on this device are used.",
  "too-long-to-show": "The request is too long for the device's screen. Shorten the value.",
  "calls-not-canonical": "The device couldn't read the call encoding. Nothing was signed.",
  persist: "The device couldn't save its counter, so it signed nothing. Check the device.",
  "blind-signing-off": "The device signs only requests it can show in words.",
  usage: "The device didn't understand the request: update its firmware.",
  unknown: "The device doesn't know this request: update its firmware.",
  "msg-not-plain-text": "The device signs plain text only.",
  "hash-mismatch": "The device built a different hash from this request. Leave BOOT alone: it times out on its own and uses no leaf.",
  "bad-signature": "The device's signature didn't verify against its public key. Nothing was sent.",
  "tree-mismatch": "The public tree doesn't match the device's root: reconnect it.",
  "no-tree": "The device's public tree isn't read yet: reconnect it.",
  disconnected: "The device disconnected. Plug it in and connect again.",
  "no-reply": "The device didn't answer. Check the cable, then connect again.",
  busy: "The device is still working on the previous request.",
};
export class DeviceError extends Error {
  reason: string;
  constructor(reason: string) {
    super(REASONS[reason] ?? `The device refused: ${reason}.`);
    this.reason = reason;
  }
}

/** A plain sentence for a failed port open. */
export function openErrorText(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  if (/no port selected|NotFoundError/i.test(m) || (e as Error)?.name === "NotFoundError") return "No device picked.";
  if (/already open|failed to open/i.test(m) || (e as Error)?.name === "InvalidStateError")
    return "The port is busy: another page or tab (or the Escape tab's signer) has it open. Close it or reload this page, then connect here.";
  return `Couldn't open the device: ${m.slice(0, 160)}`;
}

function buildLevels(pubSeed: Uint8Array, leafHashes: Uint8Array[]) {
  const levels: Uint8Array[][] = [leafHashes];
  for (let l = 1; l <= TREE_HEIGHT; l++) {
    const below = levels[l - 1]!;
    const row: Uint8Array[] = [];
    for (let i = 0; i < below.length / 2; i++) row.push(nodeHash(pubSeed, l, i, below[2 * i]!, below[2 * i + 1]!));
    levels.push(row);
  }
  return levels;
}

type Waiter = { pick: (line: string) => boolean; fail: (e: Error) => void };

export class SerialDevice {
  /** every WOTS| line in and out (long lines cut), for a small log on the page */
  onLog?: (line: string) => void;
  onClose?: () => void;
  info: DeviceInfo | null = null;
  private levels: Uint8Array[][] | null = null;
  private levelsRoot = "";
  private waiters: Waiter[] = [];
  private working = false;
  private closed = false;
  private port: SerialPortLike;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private reader: ReadableStreamDefaultReader<string>;
  private piped: Promise<void>;

  private constructor(port: SerialPortLike, writer: WritableStreamDefaultWriter<Uint8Array>, reader: ReadableStreamDefaultReader<string>, piped: Promise<void>) {
    this.port = port;
    this.writer = writer;
    this.reader = reader;
    this.piped = piped;
  }

  /** Asks the person to pick the port, then opens it without resetting the ESP32. */
  static async connect(): Promise<SerialDevice> {
    const port = await (navigator as unknown as { serial: SerialLike }).serial.requestPort();
    await port.open({ baudRate: 115200, bufferSize: 1 << 16 }); // the tree arrives in a ~20 KB burst; the 255-byte default drops lines
    await port.setSignals?.({ dataTerminalReady: false, requestToSend: false }); // don't auto-reset the ESP32
    const decoder = new TextDecoderStream();
    const piped = port.readable.pipeTo(decoder.writable as unknown as WritableStream<Uint8Array>).catch(() => {});
    const dev = new SerialDevice(port, port.writable.getWriter(), decoder.readable.getReader(), piped);
    void dev.readLoop();
    return dev;
  }

  get connected() {
    return !this.closed;
  }
  get treeReady() {
    return !!this.levels && !!this.info && this.levelsRoot === this.info.root;
  }

  private log(l: string) {
    this.onLog?.(l.length > 96 ? `${l.slice(0, 96)}…` : l);
  }

  private async readLoop() {
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          this.onLine(buf.slice(0, i).trim());
          buf = buf.slice(i + 1);
        }
      }
    } catch {
      // the cable was pulled or the port closed
    }
    this.markClosed();
  }

  private onLine(line: string) {
    if (!line.startsWith("WOTS|")) return;
    if (!line.startsWith("WOTS|LH|") && !line.startsWith("WOTS|SIG|")) this.log(`← ${line}`);
    this.waiters = this.waiters.filter((w) => !w.pick(line));
  }

  private markClosed() {
    if (this.closed) return;
    this.closed = true;
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) w.fail(new DeviceError("disconnected"));
    this.onClose?.();
  }

  private async send(line: string) {
    if (this.closed) throw new DeviceError("disconnected");
    await this.writer.write(new TextEncoder().encode(line + "\n"));
    this.log(`→ ${line}`);
  }

  /**
   * Resolves with the first line `pick` accepts (`pick` sees every line before it). `extend` restarts the timer, for a
   * request that moves from "the device is checking" to "the person is reading the screen".
   */
  private waitFor(pick: (line: string) => boolean, ms: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let arm: (t: number) => void = () => {};
    const promise = new Promise<string>((resolve, reject) => {
      const w: Waiter = {
        pick: (line) => {
          if (!pick(line)) return false;
          clearTimeout(timer);
          resolve(line);
          return true;
        },
        fail: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      this.waiters.push(w);
      arm = (t: number) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          this.waiters = this.waiters.filter((x) => x !== w);
          reject(new DeviceError("no-reply"));
        }, t);
      };
      arm(ms);
    });
    return { promise, extend: (t: number) => arm(t) };
  }

  private async exclusive<T>(f: () => Promise<T>): Promise<T> {
    if (this.closed) throw new DeviceError("disconnected");
    if (this.working) throw new DeviceError("busy");
    this.working = true;
    try {
      return await f();
    } finally {
      this.working = false;
    }
  }

  /** WOTS|INFO: the device's key and its next leaf (null when it has no key yet). */
  readInfo(): Promise<DeviceInfo | null> {
    return this.exclusive(() => this.infoNow());
  }
  private async infoNow(): Promise<DeviceInfo | null> {
    const w = this.waitFor((l) => l.startsWith("WOTS|INFO|"), 10_000);
    await this.send("WOTS|INFO");
    const parts = (await w.promise).split("|");
    if (parts[2] === "NOKEY") return (this.info = null);
    this.info = { next: Number(parts[2]), pubSeed: `0x${parts[3]}` as Hex, root: `0x${parts[4]}` as Hex };
    return this.info;
  }

  /** WOTS|LEAVES: the 256 public leaf hashes; the tree is rebuilt here and must end in the device's root. */
  readTree(onProgress?: (n: number) => void): Promise<void> {
    return this.exclusive(async () => {
      const info = this.info ?? (await this.infoNow());
      if (!info) throw new DeviceError("no-key");
      const hashes: Uint8Array[] = new Array(LEAVES);
      onProgress?.(0);
      const w = this.waitFor((l) => {
        if (l.startsWith("WOTS|LH|")) {
          const [, , i, h] = l.split("|");
          hashes[Number(i)] = fromHex(h!);
          if (Number(i) % 16 === 15) onProgress?.(Number(i) + 1);
        }
        return l.startsWith("WOTS|ROOT|") || l.startsWith("WOTS|ERR|");
      }, 10 * 60_000); // a few seconds once the device has the tree cached, ~40 s the first time
      await this.send("WOTS|LEAVES");
      const end = await w.promise;
      if (end.startsWith("WOTS|ERR|")) throw new DeviceError(end.split("|")[2] ?? "unknown");
      const got = hashes.filter(Boolean).length;
      if (got !== LEAVES) throw new Error(`Missed ${LEAVES - got} of 256 tree lines: connect again.`);
      const levels = buildLevels(fromHex(info.pubSeed), hashes);
      const root = toHex(levels[TREE_HEIGHT]![0]!);
      if (root !== info.root.toLowerCase() || `0x${end.split("|")[2]}`.toLowerCase() !== info.root.toLowerCase()) throw new DeviceError("tree-mismatch");
      this.levels = levels;
      this.levelsRoot = info.root;
      onProgress?.(LEAVES);
    });
  }

  /**
   * Signs one clear-signing request with leaf `leaf` (the device's own next leaf). The device rebuilds the hash from the
   * request, reports it (it must equal req.sigHash), shows the request page by page and signs after the BOOT press.
   * The witness is assembled with the public tree and verified here before it is returned.
   */
  sign(req: DeviceRequest, leaf: number, hooks: { onAsk?: (leaf: number) => void } = {}): Promise<SignedWitness> {
    return this.exclusive(async () => {
      const info = await this.infoNow();
      if (!info) throw new DeviceError("no-key");
      if (info.next !== leaf) throw new DeviceError("leaf-mismatch");
      if (!this.treeReady) throw new DeviceError("no-tree");
      const pub = { root: fromHex(info.root), pubSeed: fromHex(info.pubSeed) };
      const sigHash = fromHex(req.sigHash);
      const g = grind(pub, leaf, sigHash); // public work, done here
      const sigs: Uint8Array[] = new Array(64);
      let signedLeaf = -1;
      let hashOk = false;
      const w = this.waitFor((l) => {
        if (l.startsWith("WOTS|HASH|")) {
          hashOk = `0x${l.split("|")[2]}`.toLowerCase() === req.sigHash.toLowerCase();
          if (!hashOk) return true; // stop here: the device is about to ask for something else
          w.extend(180_000); // the device shows the request now (90 s on the device) and then signs
        }
        if (l.startsWith("WOTS|ASK|")) hooks.onAsk?.(Number(l.split("|")[2]));
        if (l.startsWith("WOTS|SIG|")) {
          const [, , k, h] = l.split("|");
          sigs[Number(k!.split("/")[0]) - 1] = fromHex(h!);
        }
        if (l.startsWith("WOTS|DONE|")) signedLeaf = Number(l.split("|")[2]);
        return l.startsWith("WOTS|DONE|") || l.startsWith("WOTS|ERR|");
      }, 20_000);
      await this.send(req.line(g.counter));
      const end = await w.promise;
      if (end.startsWith("WOTS|ERR|")) {
        await this.infoNow().catch(() => null);
        throw new DeviceError(end.split("|")[2] ?? "unknown");
      }
      if (!hashOk) throw new DeviceError("hash-mismatch");
      await this.infoNow().catch(() => null); // the counter moved on
      if (signedLeaf !== leaf || sigs.filter(Boolean).length !== 64) throw new DeviceError("bad-signature");
      const witness = encodeWitness({ leaf, counter: g.counter, sigs, path: authPath(this.levels!, leaf) });
      if (witness.length !== WITNESS_BYTES || !verify(pub, sigHash, witness)) throw new DeviceError("bad-signature");
      return { leaf, counter: g.counter, tries: g.tries, witness: toHex(witness) as Hex };
    });
  }

  /** Releases the port (so another page or a reconnect can open it). */
  async close() {
    try {
      await this.reader.cancel();
    } catch {
      // already gone
    }
    await this.piped;
    try {
      this.writer.releaseLock();
    } catch {
      // already released
    }
    await this.port.close().catch(() => {});
    this.markClosed();
  }
}
