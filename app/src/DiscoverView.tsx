import { useState } from "react";
import { COUNCILS, scanSafe } from "@lifeboat/core";
import snapshot from "../../evidence/discovery/councils.json";
import { REPO, safeClient as client, safeLogs as logs } from "./lib";
import { Radar } from "./ui";
import { SafeProof, SafeTag, type SafeRow } from "./SafeTag";
import QuantumPanel from "./QuantumPanel";

type Row = SafeRow;

export default function DiscoverView() {
  const [rows, setRows] = useState<Row[]>(snapshot.results as unknown as Row[]);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const rerun = async () => {
    setErr("");
    const out: Row[] = [];
    try {
      for (const c of COUNCILS) {
        setBusy(c.label);
        out.push((await scanSafe(client, logs, c.safe, { label: c.label, maxExecutions: 80 })) as unknown as Row);
      }
      setRows(out);
      setLive(true);
    } catch (e) {
      setErr(String((e as Error).message).slice(0, 200));
    } finally {
      setBusy("");
    }
  };

  const flipped = rows.filter((r) => !r.takeableByNonce && r.takeableWithSignatures);
  return (
    <>
      <section className="section" style={{ marginTop: 26 }}>
        <div className="label">Hidden exposure · Ethereum mainnet · public infrastructure only</div>
        <h2>
          Never sent a transaction. <span className="o">Still exposed.</span>
        </h2>
        <p className="lead">
          A multisig signer publishes its public key every time it signs, even if it has never sent a transaction itself. A "has it sent a transaction?" check misses that. We recover the signer from every
          signature in each Safe's executed transactions.
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div className="examples" style={{ marginTop: 0 }}>
            <button onClick={rerun} disabled={!!busy}>
              {busy ? `scanning ${busy}…` : "↻ re-run live in your browser"}
            </button>
          </div>
          <span className="note">
            {live ? "live result" : "snapshot"} · {rows[0] ? `Ethereum block ${String(rows[0].block)}` : ""} · {live ? "" : `scanned ${new Date(snapshot.scannedAt).toUTCString()}`}
          </span>
        </div>
        {busy && (
          <div className="board loading" style={{ marginTop: 14 }}>
            <Radar />
            <div>
              <div className="stencil" style={{ fontSize: 28 }}>
                Recovering signers: {busy}
              </div>
              <div className="note">owners, thresholds, nonces on 5 chains, then every signature in the Safe's executions</div>
            </div>
          </div>
        )}
        {err && <p className="error-box">{err}</p>}
      </section>

      <section className="section">
        <div className="seal bad">
          <span className="rubber bad">{flipped.length} flipped</span>
          <div>
            <div className="big">
              {flipped.length} of {rows.length} hide an open upgrade path from a nonce check
            </div>
            <div className="muted">
              Counting signatures, {rows.filter((r) => r.takeableWithSignatures).length} of {rows.length} have at least their threshold of keys already public on-chain. No quantum computer can do this today: this is
              readiness data.
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <SafeProof rows={rows} />
      </section>

      <QuantumPanel />

      <section className="section grid">
        {rows.map((r) => (
          <SafeTag key={r.safe} r={r} />
        ))}
      </section>
      <p className="note section">
        Method and code: <a href={`${REPO}/blob/main/packages/core/src/safe-scan.ts`}>safe-scan.ts</a> · raw snapshot: <a href={`${REPO}/blob/main/evidence/discovery/councils.json`}>councils.json</a>
      </p>
    </>
  );
}
