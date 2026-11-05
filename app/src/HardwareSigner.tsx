// Web Serial bridge to the ESP32 signer (firmware/esp32/lifeboat_signer). The browser holds only public data:
// it grinds the counter, keeps the public Merkle tree, and verifies every signature the device returns.
import { useRef, useState } from "react";
import { authPath, encodeWitness, fromHex, grind, keccak, nodeHash, toHex, verify, LEAVES, TREE_HEIGHT, WITNESS_BYTES } from "@lifeboat/pq";
import { LuggageTag, Pill } from "./ui";

type Info = { next: number; pubSeed: string; root: string } | null;
// minimal Web Serial typing (not in every TS DOM lib)
type SerialPortLike = {
  open(o: { baudRate: number }): Promise<void>;
  setSignals?(s: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};

const treeKey = (root: string) => `lifeboat-hw-leaves-${root}`;

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

export default function HardwareSigner() {
  const supported = typeof navigator !== "undefined" && "serial" in navigator;
  const [status, setStatus] = useState("not connected");
  const [info, setInfo] = useState<Info>(null);
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ ok: boolean; leaf: number; tries: number; text: string } | null>(null);
  const writer = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const waiters = useRef<((line: string) => boolean)[]>([]);
  const leafHashes = useRef<Uint8Array[]>([]);

  const push = (l: string) => setLog((x) => [...x.slice(-7), l.length > 90 ? l.slice(0, 90) + "…" : l]);
  const send = async (line: string) => {
    await writer.current!.write(new TextEncoder().encode(line + "\n"));
    push(`→ ${line}`);
  };
  /** Resolves with the first line `pick` accepts; `pick` also sees every line before it. */
  const until = (pick: (line: string) => boolean, ms = 120_000) =>
    new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("device timed out")), ms);
      waiters.current.push((line) => {
        if (!pick(line)) return false;
        clearTimeout(t);
        resolve(line);
        return true;
      });
    });

  const onLine = (line: string) => {
    if (!line.startsWith("WOTS|")) return;
    if (!line.startsWith("WOTS|LH|") && !line.startsWith("WOTS|SIG|")) push(`← ${line}`);
    waiters.current = waiters.current.filter((w) => !w(line));
  };

  const connect = async () => {
    try {
      const port = (await (navigator as unknown as { serial: { requestPort(): Promise<SerialPortLike> } }).serial.requestPort()) as SerialPortLike;
      await port.open({ baudRate: 115200 });
      await port.setSignals?.({ dataTerminalReady: false, requestToSend: false }); // don't auto-reset the ESP32
      writer.current = port.writable.getWriter();
      const reader = port.readable.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
      (async () => {
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            onLine(buf.slice(0, i).trim());
            buf = buf.slice(i + 1);
          }
        }
      })();
      setStatus("connected");
      await refresh();
    } catch (e) {
      setStatus(`couldn't connect: ${(e as Error).message}`);
    }
  };

  const refresh = async () => {
    const p = until((l) => l.startsWith("WOTS|INFO|"), 10_000);
    await send("WOTS|INFO");
    const parts = (await p).split("|");
    if (parts[2] === "NOKEY") return setInfo(null), setStatus("connected · no key on the device yet");
    const i = { next: Number(parts[2]), pubSeed: "0x" + parts[3], root: "0x" + parts[4] };
    setInfo(i);
    const cached = localStorage.getItem(treeKey(i.root));
    leafHashes.current = cached ? (JSON.parse(cached) as string[]).map(fromHex) : [];
    setStatus(`connected · key ${i.root.slice(0, 10)}… · next leaf ${i.next}${cached ? "" : " · public tree not cached"}`);
  };

  const collectTree = async (cmd: string) => {
    const hashes: Uint8Array[] = new Array(LEAVES);
    setProgress(0);
    const done = until((l) => {
      if (l.startsWith("WOTS|LH|")) {
        const [, , i, h] = l.split("|");
        hashes[Number(i)] = fromHex(h!);
        setProgress(Number(i) + 1);
      }
      return l.startsWith("WOTS|ROOT|") || l.startsWith("WOTS|ERR|");
    }, 10 * 60_000);
    await send(cmd);
    const end = await done;
    if (end.startsWith("WOTS|ERR|")) throw new Error(end);
    const deviceRoot = "0x" + end.split("|")[2];
    const levels = buildLevels(fromHex(info?.pubSeed ?? "0x" + "00".repeat(32)), hashes);
    return { hashes, deviceRoot, levels };
  };

  const keygen = async () => {
    const entropy = crypto.getRandomValues(new Uint8Array(32));
    setStatus("generating 256 one-time keys on the device (~40 s)…");
    const { hashes, deviceRoot } = await collectTree(`WOTS|KEYGEN|${toHex(entropy)}`);
    await refresh();
    localStorage.setItem(treeKey(deviceRoot), JSON.stringify(hashes.map(toHex)));
    leafHashes.current = hashes;
    await refresh();
  };

  const fetchTree = async () => {
    setStatus("re-reading the public tree from the device (~40 s)…");
    const { hashes, deviceRoot } = await collectTree("WOTS|LEAVES");
    localStorage.setItem(treeKey(deviceRoot), JSON.stringify(hashes.map(toHex)));
    leafHashes.current = hashes;
    await refresh();
  };

  const signTest = async (text: string) => {
    if (!info) return;
    setResult(null);
    const pub = { root: fromHex(info.root), pubSeed: fromHex(info.pubSeed) };
    const levels = buildLevels(pub.pubSeed, leafHashes.current);
    if (toHex(levels[TREE_HEIGHT]![0]!) !== info.root) return setStatus("cached tree doesn't match the device root: re-read it");
    const sigHash = keccak(new TextEncoder().encode(text));
    const g = grind(pub, info.next, sigHash); // public work, done here
    const sigs: Uint8Array[] = new Array(64);
    let leaf = -1;
    const done = until((l) => {
      if (l.startsWith("WOTS|SIG|")) {
        const [, , k, h] = l.split("|");
        sigs[Number(k!.split("/")[0]) - 1] = fromHex(h!);
      }
      if (l.startsWith("WOTS|ASK|")) setStatus(`device is asking: press BOOT on the ESP32 (Approve) to sign with leaf ${l.split("|")[2]}`);
      if (l.startsWith("WOTS|DONE|")) leaf = Number(l.split("|")[2]);
      return l.startsWith("WOTS|DONE|") || l.startsWith("WOTS|ERR|");
    }, 90_000);
    await send(`WOTS|SIGN|${toHex(sigHash)}|${g.counter}|${text.slice(0, 20)}`);
    const end = await done;
    if (end.startsWith("WOTS|ERR|")) {
      setStatus(`device refused: ${end.split("|")[2]}`);
      return refresh();
    }
    const witness = encodeWitness({ leaf, counter: g.counter, sigs, path: authPath(levels, leaf) });
    const ok = verify(pub, sigHash, witness) && witness.length === WITNESS_BYTES;
    setResult({ ok, leaf, tries: g.tries, text });
    await refresh();
  };

  return (
    <LuggageTag tone={result ? (result.ok ? "good" : "bad") : "neutral"} verdict={result ? (result.ok ? "Signed" : "Invalid") : "Device"} id="Hardware signer (ESP32)" meta={status}>
      <p className="desc">
        The secret seed and the leaf counter live only on the device. It shows each request on its screen, waits for the physical Approve button, saves the counter <b>before</b> signing, and refuses
        any counter that doesn't match its own digest. This page holds only public data and checks every signature it gets back.
      </p>
      {!supported ? (
        <p className="note">Web Serial isn't available in this browser. Use Chrome or Edge on a desktop.</p>
      ) : (
        <div className="examples" style={{ marginTop: 0 }}>
          <button onClick={connect}>1 · connect</button>
          <button onClick={keygen} disabled={!writer.current || !!info}>
            2 · generate key
          </button>
          <button onClick={fetchTree} disabled={!info}>
            re-read public tree
          </button>
          <button onClick={() => signTest(`Lifeboat test ${new Date().toISOString()}`)} disabled={!info || !leafHashes.current.length}>
            3 · sign a test message
          </button>
        </div>
      )}
      {progress > 0 && progress < LEAVES && <p className="note">public tree: {progress}/256 leaves</p>}
      {result && (
        <p style={{ marginTop: 10 }}>
          <Pill status={result.ok ? "ok" : "exposed"}>{result.ok ? "valid" : "invalid"}</Pill> signature for "{result.text}" with leaf {result.leaf} (counter found in {result.tries} tries on this
          laptop), checked here against the device's public key.
        </p>
      )}
      {log.length > 0 && (
        <pre className="mono" style={{ background: "var(--paper)", border: "2px solid var(--ink)", padding: 10, fontSize: 11.5, overflowX: "auto", marginTop: 10 }}>
          {log.join("\n")}
        </pre>
      )}
    </LuggageTag>
  );
}
