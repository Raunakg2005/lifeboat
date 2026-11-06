import { useEffect, useState } from "react";
import { desc, eq } from "@arkiv-network/sdk/query";
import { Alert, PUBLISHER, Watch } from "@lifeboat/core";
import { REPO, arkiv, arkivErrorText, expiresIn, short } from "./lib";
import { ArkivLink } from "./EvidenceDrawer";

type Row = { key: string; expiresAt: bigint; target: string; kind: string; chainId: string; event: string; severity: string; detail: string; block: string };
type Sev = "all" | "high" | "medium" | "info";
const SEVERITIES = ["high", "medium", "info"] as const;
const PAGE = 30;
const net = (c: string) => (c === "1" ? "Ethereum (read-only)" : c === "11155111" ? "Sepolia" : `chain ${c}`);

/** Monitor alerts and the watch list, read from Arkiv (lifeboat.alert.v1 / lifeboat.watch.v1). */
export default function AlertsBoard() {
  const [sev, setSev] = useState<Sev>("all");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [total, setTotal] = useState<bigint | null>(null);
  const [block, setBlock] = useState(0n);
  const [counts, setCounts] = useState<Record<string, bigint> | null>(null);
  const [watching, setWatching] = useState<bigint | null>(null);
  const [err, setErr] = useState("");
  const [attempt, setAttempt] = useState(0); // "try again" reads Arkiv again, without a page reload

  // Totals from the node's count projection: the watch list, and alerts per severity.
  useEffect(() => {
    let live = true;
    Promise.all([arkiv.count().from(Watch).ownedBy(PUBLISHER).fetch(), ...SEVERITIES.map((s) => arkiv.count().from(Alert).where(eq("severity", s)).ownedBy(PUBLISHER).fetch())])
      .then(([w, ...c]) => {
        if (!live) return;
        setWatching(w);
        setCounts(Object.fromEntries(SEVERITIES.map((s, i) => [s, c[i] ?? 0n])));
      })
      .catch((e) => console.warn("Monitor board: Arkiv count failed", e));
    return () => {
      live = false;
    };
  }, [attempt]);

  // The list itself: filtered by severity on the node, newest first.
  useEffect(() => {
    let live = true;
    setRows(null);
    setErr("");
    const q = arkiv.select({ $key: true, $expiresAt: true, target: true, kind: true, chainId: true, event: true, severity: true, detail: true, checkedBlock: true }).from(Alert).withCount().ownedBy(PUBLISHER);
    (sev === "all" ? q : q.where(eq("severity", sev)))
      .orderBy(desc("$expiresAt"))
      .limit(PAGE)
      .fetch()
      .then((a) => {
        if (!live) return;
        setBlock(a.blockNumber);
        setTotal(a.count);
        setRows(
          a.entities.map((e) => ({
            key: e.$key,
            expiresAt: e.$expiresAt,
            target: e.target.value,
            kind: e.kind.value,
            chainId: String(e.chainId.value),
            event: e.event.value,
            severity: e.severity.value,
            detail: e.detail.value,
            block: String(e.checkedBlock.value),
          })),
        );
      })
      .catch((e) => {
        if (!live) return;
        console.warn("Monitor board: Arkiv query failed", e);
        setErr(arkivErrorText(e));
        setRows([]);
      });
    return () => {
      live = false;
    };
  }, [sev, attempt]);

  const all = counts ? SEVERITIES.reduce((n, s) => n + (counts[s] ?? 0n), 0n) : null;

  return (
    <div className="board">
      <div className="board-head">
        <h3>Monitor</h3>
        <span className="label">{watching === null ? "reading Arkiv…" : `${watching} targets watched · alerts expire after 30 days`}</span>
      </div>
      <div className="board-sub">
        <div className="chips" role="group" aria-label="Severity">
          {(["all", ...SEVERITIES] as const).map((s) => {
            const n = s === "all" ? all : (counts?.[s] ?? null);
            return (
              <button key={s} type="button" aria-pressed={sev === s} className={s} onClick={() => setSev(s)}>
                {s === "all" ? "All" : s}
                {n !== null && <b>{String(n)}</b>}
              </button>
            );
          })}
        </div>
        <span style={{ marginLeft: "auto" }}>{total !== null && rows ? (BigInt(rows.length) < total ? `newest ${rows.length} of ${total}` : `${total} on Arkiv`) : ""}</span>
      </div>
      {rows === null ? (
        <div className="board-note">reading Arkiv…</div>
      ) : err ? (
        <div className="board-note">
          Arkiv didn't answer: {err}{" "}
          <button type="button" className="link-btn" onClick={() => setAttempt((n) => n + 1)}>
            try again
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="board-note">{sev === "all" ? "No alerts yet." : `No ${sev} alerts.`}</div>
      ) : (
        <div className="table-wrap">
          <table className="manifest stack">
            <thead>
              <tr>
                <th>Severity</th>
                <th>What changed</th>
                <th>Target</th>
                <th>Network</th>
                <th>Record</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td data-label="Severity">
                    <span className={`pill ${r.severity === "high" ? "exposed" : r.severity === "medium" ? "not-seen" : "contract"}`}>{r.severity}</span>
                  </td>
                  <td data-label="Changed">
                    <b>{r.event.replace(/-/g, " ")}</b>
                    <div className="note">{r.detail}</div>
                  </td>
                  <td className="m" data-label="Target">{r.kind === "name" ? r.target : short(r.target)}</td>
                  <td className="m" data-label="Network">
                    {net(r.chainId)} · block {Number(r.block).toLocaleString("en-US")}
                  </td>
                  <td data-label="Record">
                    <div className="rec-meta">
                      <span>{expiresIn(r.expiresAt, block)}</span>
                      <ArkivLink entityKey={r.key} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="board-note">
        The Monitor re-checks every watched Safe, Quantum Guard and name, and raises an alert for a risky state or a change: more signer keys public, a recovery started on a guard (veto it with the PQ key
        if it isn't you), a guard removed, a name's verdict changed. Delivered here, on Arkiv, and to a team's own webhook. ·{" "}
        <a href={`${REPO}/blob/main/docs/monitor.md`} target="_blank" rel="noreferrer">
          how it works
        </a>
      </div>
    </div>
  );
}
