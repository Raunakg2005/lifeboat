import { useState } from "react";
import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { COUNCILS, PUBLIC_RPC, TENDERLY_MAINNET, scanSafe, type SafeScan } from "@lifeboat/core";
import snapshot from "../../evidence/discovery/councils.json";
import { REPO, short } from "./lib";
import { LuggageTag, Radar } from "./ui";

const client = createPublicClient({ chain: mainnet, transport: http(PUBLIC_RPC.mainnet, { retryCount: 3, timeout: 30_000, batch: { batchSize: 50 } }) }) as PublicClient;
const logs = createPublicClient({ chain: mainnet, transport: http(TENDERLY_MAINNET, { retryCount: 3, timeout: 60_000 }) }) as PublicClient;

type Row = Pick<SafeScan, "label" | "safe" | "threshold" | "exposedByNonce" | "exposedTotal" | "takeableByNonce" | "takeableWithSignatures" | "executionsDecoded" | "executionsSeen"> & {
  block: string | bigint;
  owners: { address: string; how: string; nested?: SafeScan["owners"][number]["nested"] }[];
};

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
              {flipped.length} of {rows.length} look safe by nonce, and aren't
            </div>
            <div className="muted">
              Counting signatures, {rows.filter((r) => r.takeableWithSignatures).length} of {rows.length} have at least their threshold of keys already public on-chain. No quantum computer can do this today: this is
              readiness data.
            </div>
          </div>
        </div>
      </section>

      <section className="section grid">
        {rows.map((r) => (
          <LuggageTag
            key={r.safe}
            tone={r.takeableWithSignatures ? "bad" : "good"}
            verdict={r.takeableWithSignatures ? (r.takeableByNonce ? "Exposed" : "Hidden") : "Holds"}
            id={r.label}
            meta={`${r.threshold}-of-${r.owners.length} · Safe ${short(r.safe)} · ${r.executionsDecoded}/${r.executionsSeen} executions decoded`}
          >
            <div className="grid cols-4" style={{ margin: "8px 0 12px" }}>
              <div>
                <div className="label">Needed to take over</div>
                <div className="stencil" style={{ fontSize: 44 }}>
                  {r.threshold}
                </div>
              </div>
              <div>
                <div className="label">Public keys by nonce</div>
                <div className="stencil" style={{ fontSize: 44 }}>
                  {r.exposedByNonce}
                </div>
              </div>
              <div>
                <div className="label">Counting signatures</div>
                <div className="stencil" style={{ fontSize: 44, color: r.takeableWithSignatures ? "var(--orange-deep)" : undefined }}>
                  {r.exposedTotal}
                </div>
              </div>
              <div>
                <div className="label">Upgrade path on Q-Day</div>
                <div className="stencil" style={{ fontSize: 44 }}>
                  {r.takeableWithSignatures ? "Open" : "Holds"}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {r.owners.map((o) => (
                <span
                  key={o.address}
                  className={`pill ${o.how === "hidden" ? "not-seen" : o.how === "contract" ? (o.nested?.takeableWithSignatures ? "exposed" : "contract") : "exposed"}`}
                  title={o.how === "signature" ? "never sent a tx; key recovered from a Safe signature" : o.how}
                >
                  {short(o.address, 3)} {o.how === "signature" ? "· sig" : o.how === "contract" ? `· Safe ${o.nested ? `${o.nested.exposedTotal}/${o.nested.owners}` : ""}` : o.how === "hidden" ? "· hidden" : ""}
                </span>
              ))}
            </div>
            <p className="note" style={{ marginTop: 10 }}>
              "sig" = never revealed by nonce; the public key was recovered from a signature. Signer addresses are truncated on purpose: this is about the council, not the people.
            </p>
          </LuggageTag>
        ))}
      </section>
      <p className="note section">
        Method and code: <a href={`${REPO}/blob/main/packages/core/src/safe-scan.ts`}>safe-scan.ts</a> · raw snapshot: <a href={`${REPO}/blob/main/evidence/discovery/councils.json`}>councils.json</a>
      </p>
    </>
  );
}
