import { useEffect, useMemo, useState } from "react";
import { desc, eq } from "@arkiv-network/sdk/query";
import { ARKIV_BLOCK_SECONDS, Aboard, Exposure, Leaf, NameCheck, PUBLISHER } from "@lifeboat/core";
import { REPO, arkiv, short, swarmUrl } from "./lib";
import { Pill, Ring, Rubber } from "./ui";

type Data = {
  block: bigint;
  exposed: { key: string; address: string; chainId: string; eth: string; via: string; expiresAt: bigint }[];
  aboard: { key: string; from: string; to: string; kind: string; chainId: string; note: string }[];
  names: { key: string; name: string; verdict: string; expiresAt: bigint; swarmRef?: string }[];
  leaves: { key: string; owner: string; root: string; leaf: string; account: string; digest: string; tx: string }[];
};

const DAY = 86400;
const life = (expiresAt: bigint, block: bigint, total: number) => {
  const s = Number(expiresAt - block) * ARKIV_BLOCK_SECONDS;
  return { fraction: s / total, label: s <= 0 ? "expired" : s > 2 * DAY ? `${Math.round(s / DAY)} d` : `re-check in ${(s / 3600).toFixed(1)} h` };
};
const chainName = (id: string) => ({ "1337": "EIP-8141 devnet", "11155111": "Sepolia", "1": "Ethereum" })[id] ?? `chain ${id}`;

export default function HarbourView() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [sort, setSort] = useState<"risk" | "newest">("risk");

  useEffect(() => {
    (async () => {
      const [block, ex, ab, nm, lv] = await Promise.all([
        arkiv.getBlockNumber(),
        arkiv.select({ $key: true, $expiresAt: true, address: true, chainId: true, ethAtRisk: true, via: true }).from(Exposure).where(eq("status", "exposed")).ownedBy(PUBLISHER).orderBy(desc("ethAtRisk")).limit(50).fetch(),
        arkiv.select({ $key: true, from: true, to: true, kind: true, chainId: true, note: true }).from(Aboard).ownedBy(PUBLISHER).limit(50).fetch(),
        arkiv.select({ $key: true, $expiresAt: true, name: true, verdict: true, swarmRef: true }).from(NameCheck).ownedBy(PUBLISHER).limit(50).fetch(),
        arkiv.select({ $key: true, $owner: true, root: true, leaf: true, account: true, digest: true, txHash: true }).from(Leaf).limit(100).fetch(),
      ]);
      setData({
        block,
        exposed: ex.entities.map((e) => ({ key: e.$key, address: e.address.value, chainId: String(e.chainId.value), eth: e.ethAtRisk.value, via: e.via.value, expiresAt: e.$expiresAt })),
        aboard: ab.entities.map((e) => ({ key: e.$key, from: e.from.value, to: e.to.value, kind: e.kind.value, chainId: String(e.chainId.value), note: e.note.value })),
        names: nm.entities.map((e) => ({ key: e.$key, name: e.name.value, verdict: e.verdict.value, expiresAt: e.$expiresAt, swarmRef: e.swarmRef?.value })),
        leaves: lv.entities.map((e) => ({ key: e.$key, owner: e.$owner, root: e.root.value, leaf: String(e.leaf.value), account: e.account.value, digest: e.digest.value.toLowerCase(), tx: e.txHash.value })),
      });
    })().catch((e) => setErr(String(e?.shortMessage ?? e?.message ?? e).slice(0, 200)));
  }, []);

  const twice = useMemo(
    () =>
      data
        ? [...data.leaves.reduce((m, l) => m.set(`${l.root}:${l.leaf}`, (m.get(`${l.root}:${l.leaf}`) ?? new Set<string>()).add(l.digest)), new Map<string, Set<string>>())].filter(([, s]) => s.size > 1)
        : [],
    [data],
  );
  const exposed = useMemo(() => (data ? [...data.exposed].sort((a, b) => (sort === "risk" ? Number(b.eth) - Number(a.eth) : Number(b.expiresAt - a.expiresAt))) : []), [data, sort]);

  return (
    <>
      <section className="section" style={{ marginTop: 26 }}>
        <div className="label">Arkiv · the public Q-Day registry</div>
        <h2>
          Harbour <span className="o">manifest</span>
        </h2>
        <p className="lead">
          Live from Arkiv. Every entry is signed by its writer and was re-checked on-chain before it was written. Readings expire after 24 hours; the audit trail is readonly, and anyone can keep it alive.
        </p>
      </section>
      {err && <p className="error-box">Arkiv is unreachable right now: {err}</p>}
      {!data && !err && <p className="note">Reading the registry from Arkiv…</p>}
      {data && (
        <div className="grid">
          <div className={`seal ${twice.length ? "bad" : "good"}`}>
            <Rubber good={!twice.length}>{twice.length ? "Signed twice" : "All clear"}</Rubber>
            <div>
              <div className="big">{twice.length ? "A one-time key signed twice" : "No one-time key has signed twice"}</div>
              <div className="muted">
                {twice.length
                  ? `${twice.length} leaf(s) signed more than one message. Those keys can be forged: move the funds now.`
                  : `${data.leaves.length} published uses of one-time keys, from any writer. Each one signed exactly one message.`}
              </div>
              {twice.map(([k, digests]) => {
                const [root, leaf] = k.split(":");
                const acct = data.leaves.find((l) => l.root === root && l.leaf === leaf)?.account ?? "";
                return (
                  <div key={k} className="mono" style={{ marginTop: 6, fontSize: 13 }}>
                    ⚠ key {short(root ?? "")} leaf #{leaf}: <b>{digests.size} different messages</b> · account {short(acct)} (the naive-wallet forgery demo)
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid cols-2">
            <div className="board">
              <div className="board-head">
                <h3>Exposed keys</h3>
                <div className="toggle" style={{ margin: 0 }}>
                  <button aria-pressed={sort === "risk"} onClick={() => setSort("risk")}>
                    Most at risk
                  </button>
                  <button aria-pressed={sort === "newest"} onClick={() => setSort("newest")}>
                    Newest
                  </button>
                </div>
              </div>
              <div className="table-wrap">
                <table className="manifest">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Where</th>
                      <th>Cargo</th>
                      <th>Valid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exposed.map((e) => {
                      const l = life(e.expiresAt, data.block, DAY);
                      return (
                        <tr key={e.key}>
                          <td className="m">{short(e.address)}</td>
                          <td>{chainName(e.chainId)}</td>
                          <td className="m">{Number(e.eth).toFixed(4)} ETH</td>
                          <td>
                            <Ring fraction={l.fraction} label={l.label} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="board">
              <div className="board-head">
                <h3>Aboard</h3>
                <span className="label">verified moves to post-quantum accounts</span>
              </div>
              {data.aboard.map((a) => (
                <div className="board-row" key={a.key} style={{ display: "block" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span>🛟</span>
                    <b>{a.kind === "rescue-sweep" ? "Rescue sweep" : a.kind === "ens-handover" ? "ENS handover" : a.kind}</b>
                    <span className="note">on {chainName(a.chainId)}</span>
                  </div>
                  <div className="mono muted" style={{ marginTop: 2 }}>
                    {short(a.from)} → {short(a.to)}
                  </div>
                </div>
              ))}
              <div className="board-head" style={{ borderTop: "3px solid var(--ink)" }}>
                <h3>Names</h3>
                <span className="label">ENS Helm check verdicts</span>
              </div>
              {data.names.map((n) => {
                const l = life(n.expiresAt, data.block, DAY);
                return (
                  <div className="board-row" key={n.key}>
                    <Pill status={n.verdict === "protected" ? "pq" : "exposed"}>{n.verdict}</Pill>
                    <b>{n.name}</b>
                    {n.swarmRef && (
                      <a className="mono" style={{ fontSize: 12 }} href={swarmUrl(n.swarmRef)} target="_blank" rel="noreferrer">
                        evidence on Swarm ↗
                      </a>
                    )}
                    <span style={{ marginLeft: "auto" }}>
                      <Ring fraction={l.fraction} label={l.label} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="board">
            <div className="board-head">
              <h3>Logbook</h3>
              <span className="label">every use of a one-time key · anyone can report a sighting</span>
            </div>
            <div className="table-wrap">
              <table className="manifest">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Leaf</th>
                    <th>Account</th>
                    <th>Where it was used</th>
                    <th>Reported by</th>
                  </tr>
                </thead>
                <tbody>
                  {data.leaves.map((l) => (
                    <tr key={l.key}>
                      <td className="m">{short(l.root)}</td>
                      <td className="m">#{l.leaf}</td>
                      <td className="m">{short(l.account)}</td>
                      <td className="m">{l.tx.startsWith("0x") ? short(l.tx, 8) : l.tx}</td>
                      <td className="m">{short(l.owner)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="note">
            Arkiv block {data.block.toString()} · writer <span className="mono">{PUBLISHER}</span> · <a href={`${REPO}/blob/main/arkiv/schema.md`}>schema</a> ·{" "}
            <a href={`${REPO}/blob/main/scripts/arkiv-query-public.mjs`}>run a query yourself</a>
          </p>
        </div>
      )}
    </>
  );
}
