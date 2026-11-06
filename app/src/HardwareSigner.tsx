// Web Serial bridge to the ESP32 signer (firmware/esp32/lifeboat_signer). The browser holds only public data, in
// memory only (nothing is saved): it grinds the counter, rebuilds the public Merkle tree from the device, and verifies
// every signature the device returns. Clear signing: the browser sends the message itself, never a bare hash; the
// device rebuilds the hash and shows the text on its screen before the button can approve it.
import { useRef, useState } from "react";
import { authPath, encodeWitness, fromHex, grind, nodeHash, toHex, verify, LEAVES, TREE_HEIGHT, WITNESS_BYTES } from "@lifeboat/pq";
import { messageRequest } from "@lifeboat/core";
import { LuggageTag, Pill } from "./ui";

type Info = { next: number; pubSeed: string; root: string } | null;
// minimal Web Serial typing (not in every TS DOM lib)
type SerialPortLike = {
  open(o: { baudRate: number; bufferSize?: number }): Promise<void>;
  setSignals?(s: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};

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
      await port.open({ baudRate: 115200, bufferSize: 1 << 16 }); // the cached tree arrives in a ~20 KB burst; the 255-byte default drops lines
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
      const i = await refresh();
      if (i) await fetchTree();
    } catch (e) {
      setStatus(`couldn't connect: ${(e as Error).message}`);
    }
  };

  // the public tree, in memory only: re-read from the device on connect (a few seconds once the device has it cached)
  const treeRoot = useRef("");
  const refresh = async (): Promise<Info> => {
    const p = until((l) => l.startsWith("WOTS|INFO|"), 10_000);
    await send("WOTS|INFO");
    const parts = (await p).split("|");
    if (parts[2] === "NOKEY") {
      setInfo(null);
      setStatus("connected · no key on the device yet");
      return null;
    }
    const i = { next: Number(parts[2]), pubSeed: "0x" + parts[3], root: "0x" + parts[4] };
    setInfo(i);
    const have = treeRoot.current === i.root && leafHashes.current.length === LEAVES;
    setStatus(`connected · key ${i.root.slice(0, 10)}… · next leaf ${i.next}${have ? "" : " · public tree not read yet"}`);
    return i;
  };

  const collectTree = async (cmd: string) => {
    const hashes: Uint8Array[] = new Array(LEAVES);
    setProgress(0);
    const done = until((l) => {
      if (l.startsWith("WOTS|LH|")) {
        const [, , i, h] = l.split("|");
        hashes[Number(i)] = fromHex(h!);
        if (Number(i) % 16 === 15) setProgress(Number(i) + 1); // don't re-render on every line
      }
      return l.startsWith("WOTS|ROOT|") || l.startsWith("WOTS|ERR|");
    }, 10 * 60_000);
    await send(cmd);
    const end = await done;
    if (end.startsWith("WOTS|ERR|")) throw new Error(end);
    const missing = Array.from({ length: LEAVES }, (_, i) => i).filter((i) => !hashes[i]);
    if (missing.length) throw new Error(`missed ${missing.length} of 256 leaf lines (first: ${missing[0]}): click "re-read public tree"`);
    setProgress(LEAVES);
    return { hashes, deviceRoot: "0x" + end.split("|")[2] };
  };

  const guard = (fn: () => Promise<void>) => () => fn().catch((e) => setStatus(`error: ${(e as Error).message}`));

  const keygen = async () => {
    const entropy = crypto.getRandomValues(new Uint8Array(32));
    setStatus("generating 256 one-time keys on the device (~40 s)…");
    const { hashes, deviceRoot } = await collectTree(`WOTS|KEYGEN|${toHex(entropy)}`);
    leafHashes.current = hashes;
    treeRoot.current = deviceRoot;
    await refresh();
  };

  const fetchTree = async () => {
    setStatus("reading the public tree from the device (a few seconds; ~40 s the first time)…");
    const { hashes, deviceRoot } = await collectTree("WOTS|LEAVES");
    leafHashes.current = hashes;
    treeRoot.current = deviceRoot;
    await refresh();
  };

  const signTest = async (text: string) => {
    if (!info) return;
    setResult(null);
    const pub = { root: fromHex(info.root), pubSeed: fromHex(info.pubSeed) };
    const levels = buildLevels(pub.pubSeed, leafHashes.current);
    if (toHex(levels[TREE_HEIGHT]![0]!) !== info.root) return setStatus("the public tree doesn't match the device root: re-read it");
    // clear signing: the device gets the text itself and rebuilds this hash from it
    const req = messageRequest(text);
    const sigHash = fromHex(req.sigHash);
    const g = grind(pub, info.next, sigHash); // public work, done here
    const sigs: Uint8Array[] = new Array(64);
    let leaf = -1;
    let deviceHash = "";
    const done = until((l) => {
      if (l.startsWith("WOTS|HASH|")) deviceHash = "0x" + l.split("|")[2];
      if (l.startsWith("WOTS|SIG|")) {
        const [, , k, h] = l.split("|");
        sigs[Number(k!.split("/")[0]) - 1] = fromHex(h!);
      }
      if (l.startsWith("WOTS|ASK|")) setStatus(`the ESP32 shows the message on its screen: read it, then press BOOT to sign (leaf ${l.split("|")[2]})`);
      if (l.startsWith("WOTS|DONE|")) leaf = Number(l.split("|")[2]);
      return l.startsWith("WOTS|DONE|") || l.startsWith("WOTS|ERR|");
    }, 150_000);
    await send(req.line(g.counter));
    const end = await done;
    if (end.startsWith("WOTS|ERR|")) {
      setStatus(`device refused: ${end.split("|")[2]}`);
      await refresh();
      return;
    }
    const witness = encodeWitness({ leaf, counter: g.counter, sigs, path: authPath(levels, leaf) });
    const ok = deviceHash === req.sigHash && verify(pub, sigHash, witness) && witness.length === WITNESS_BYTES;
    setResult({ ok, leaf, tries: g.tries, text });
    await refresh();
  };

  return (
    <LuggageTag tone={result ? (result.ok ? "good" : "bad") : "neutral"} verdict={result ? (result.ok ? "Signed" : "Invalid") : "Device"} id="Hardware signer (ESP32)" meta={status}>
      <p className="desc">
        The secret seed and the leaf counter live only on the device. <b>Clear signing:</b> the device never signs a bare hash. It gets the request itself, rebuilds the hash from it, shows it in words on its screen, waits for the physical Approve button, saves the counter <b>before</b> signing, and refuses
        any counter that doesn't match its own digest. This page holds only public data and checks every signature it gets back.
      </p>
      {!supported ? (
        <p className="note">Web Serial isn't available in this browser. Use Chrome or Edge on a desktop.</p>
      ) : (
        <div className="examples" style={{ marginTop: 0 }}>
          <button onClick={connect}>1 · connect</button>
          <button onClick={guard(keygen)} disabled={!writer.current || !!info}>
            2 · generate key
          </button>
          <button onClick={guard(fetchTree)} disabled={!info}>
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
