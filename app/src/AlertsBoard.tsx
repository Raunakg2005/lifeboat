import { useEffect, useState } from "react";
import { Alert, PUBLISHER, Watch } from "@lifeboat/core";
import { REPO, arkiv, short } from "./lib";

type Row = { key: string; target: string; kind: string; chainId: string; event: string; severity: string; detail: string; block: string };
const net = (c: string) => (c === "1" ? "Ethereum (read-only)" : c === "11155111" ? "Sepolia" : `chain ${c}`);

/** Monitor alerts and the watch list, read from Arkiv (lifeboat.alert.v1 / lifeboat.watch.v1). */
export default function AlertsBoard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [watching, setWatching] = useState<number | null>(null);
  useEffect(() => {
    Promise.all([
      arkiv.select({ $key: true, target: true, kind: true, chainId: true, event: true, severity: true, detail: true, checkedBlock: true }).from(Alert).ownedBy(PUBLISHER).limit(100).fetch(),
      arkiv.select({ $key: true }).from(Watch).ownedBy(PUBLISHER).limit(100).fetch(),
    ])
      .then(([a, w]) => {
        setRows(
          a.entities
            .map((e) => ({
            key: e.$key,
            target: e.target.value,
            kind: e.kind.value,
            chainId: String(e.chainId.value),
            event: e.event.value,
            severity: e.severity.value,
            detail: e.detail.value,
            block: String(e.checkedBlock.value),
          }))
            .sort((x, y) => (x.severity === y.severity ? 0 : x.severity === "high" ? -1 : 1))
            .slice(0, 30),
        );
        setWatching(w.entities.length);
      })
      .catch((e) => {
        console.warn("Monitor board: Arkiv query failed", e);
        setRows([]);
        setWatching(0);
      });
  }, []);

  return (
    <div className="board">
      <div className="board-head">
        <h3>Monitor</h3>
        <span className="label">{watching === null ? "reading Arkiv…" : `${watching} targets watched · alerts expire after 30 days`}</span>
      </div>
      {rows === null ? (
        <div className="board-note">reading Arkiv…</div>
      ) : rows.length === 0 ? (
        <div className="board-note">No alerts yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="manifest">
            <thead>
              <tr>
                <th>Severity</th>
                <th>What changed</th>
                <th>Target</th>
                <th>Network</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    <span className={`pill ${r.severity === "high" ? "exposed" : r.severity === "medium" ? "not-seen" : "contract"}`}>{r.severity}</span>
                  </td>
                  <td>
                    <b>{r.event.replace(/-/g, " ")}</b>
                    <div className="note">{r.detail}</div>
                  </td>
                  <td className="m">{r.kind === "name" ? r.target : short(r.target)}</td>
                  <td className="m">
                    {net(r.chainId)} · block {Number(r.block).toLocaleString("en-US")}
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
