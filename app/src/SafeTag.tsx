import type { SafeScan } from "@lifeboat/core";
import { short } from "./lib";
import { LuggageTag } from "./ui";

/** A Safe scan as shown in the app: the live result, or the JSON snapshot (where block is a string). */
export type SafeRow = Pick<SafeScan, "label" | "safe" | "threshold" | "exposedByNonce" | "exposedTotal" | "takeableByNonce" | "takeableWithSignatures" | "executionsDecoded" | "executionsSeen"> & {
  block: string | bigint;
  owners: { address: string; how: string; nested?: SafeScan["owners"][number]["nested"]; nonces?: Record<string, number>; bySignature?: { txHash: string; publicKey: string } | null }[];
};

/** The luggage tag for one Safe: what it takes to take over, what a nonce check sees, what signatures show. */
export function SafeTag({ r }: { r: SafeRow }) {
  return (
    <LuggageTag
      tone={r.takeableWithSignatures ? "bad" : "good"}
      verdict={r.takeableWithSignatures ? (r.takeableByNonce ? "Exposed" : "Hidden") : "Holds"}
      id={r.label}
      meta={`${r.threshold}-of-${r.owners.length} · Safe ${short(r.safe)} · ${r.executionsDecoded}/${r.executionsSeen} executions decoded`}
    >
      <div className="grid cols-4 kpis" style={{ margin: "8px 0 12px" }}>
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
        "sig" = never revealed by nonce; the public key was recovered from a signature. Signer addresses are truncated on purpose: this is about the Safe, not the people.
      </p>
    </LuggageTag>
  );
}

/** One concrete, checkable example: a signer with no transactions whose public key comes out of a Safe signature. */
export function SafeProof({ rows }: { rows: SafeRow[] }) {
  const proof = rows.flatMap((r) => r.owners.filter((o) => o.how === "signature" && o.bySignature).map((o) => ({ r, o })))[0];
  if (!proof) return null;
  return (
    <div className="board">
      <div className="board-head">
        <h3>Proof</h3>
        <span className="label">one example · check it yourself</span>
      </div>
      <div className="board-body">
        <p style={{ marginTop: 0 }}>
          A signer of the <b>{proof.r.label}</b> (<span className="mono">{short(proof.o.address, 3)}</span>) has sent <b>0 transactions</b> on {Object.keys(proof.o.nonces ?? {}).length || 5} chains, so a nonce
          check calls it safe. But it signed Safe transaction{" "}
          <a className="mono" href={`https://etherscan.io/tx/${proof.o.bySignature!.txHash}`} target="_blank" rel="noreferrer">
            {short(proof.o.bySignature!.txHash, 8)} ↗
          </a>
          , and its <b>public key</b> comes straight out of that signature:
        </p>
        <p className="mono" style={{ wordBreak: "break-all", background: "var(--paper)", border: "2px solid var(--ink)", padding: 10, fontSize: 12.5 }}>
          {proof.o.bySignature!.publicKey.slice(0, 34)}…{proof.o.bySignature!.publicKey.slice(-8)} <span className="faint">(65 bytes, recovered with ecrecover over the safeTxHash)</span>
        </p>
        <p className="note" style={{ marginBottom: 0 }}>
          Anyone can repeat this from public data: read the transaction's <span className="mono">signatures</span> bytes, take the safeTxHash from the Safe's ExecutionSuccess event, and recover. That public
          key is what a future quantum computer would need. The address is truncated on purpose.
        </p>
      </div>
    </div>
  );
}
