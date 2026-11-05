import { useEffect, useState } from "react";
import { desc, eq } from "@arkiv-network/sdk/query";
import { ARKIV_BLOCK_SECONDS, Aboard, Exposure, Leaf, NameCheck, PUBLISHER } from "@lifeboat/core";
import { REPO, arkiv, short } from "./lib";
import { Badge, ExpiryRing, Seal } from "./ui";

type Data = {
  block: bigint;
  exposed: { key: string; address: string; chainId: string; eth: string; via: string; expiresAt: bigint }[];
  aboard: { key: string; from: string; to: string; kind: string; chainId: string; note: string }[];
  names: { key: string; name: string; verdict: string; expiresAt: bigint }[];
  leaves: { key: string; owner: string; root: string; leaf: string; account: string; digest: string; tx: string }[];
};

const DAY = 86400;
const life = (expiresAt: bigint, block: bigint, total: number) => {
  const s = Number(expiresAt - block) * ARKIV_BLOCK_SECONDS;
  return { fraction: s / total, label: s <= 0 ? "expired" : s > 2 * DAY ? `${Math.round(s / DAY)} d left` : `${(s / 3600).toFixed(1)} h left` };
};
const chainName = (id: string) => ({ "1337": "EIP-8141 devnet", "11155111": "Sepolia", "1": "Ethereum" })[id] ?? `chain ${id}`;

export default function HarbourView() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const [block, ex, ab, nm, lv] = await Promise.all([
        arkiv.getBlockNumber(),
        arkiv.select({ $key: true, $expiresAt: true, address: true, chainId: true, ethAtRisk: true, via: true }).from(Exposure).where(eq("status", "exposed")).ownedBy(PUBLISHER).orderBy(desc("ethAtRisk")).limit(50).fetch(),
        arkiv.select({ $key: true, from: true, to: true, kind: true, chainId: true, note: true }).from(Aboard).ownedBy(PUBLISHER).limit(50).fetch(),
        arkiv.select({ $key: true, $expiresAt: true, name: true, verdict: true }).from(NameCheck).ownedBy(PUBLISHER).limit(50).fetch(),
        arkiv.select({ $key: true, $owner: true, root: true, leaf: true, account: true, digest: true, txHash: true }).from(Leaf).limit(100).fetch(),
      ]);
      setData({
        block,
        exposed: ex.entities.map((e) => ({ key: e.$key, address: e.address.value, chainId: String(e.chainId.value), eth: e.ethAtRisk.value, via: e.via.value, expiresAt: e.$expiresAt })),
        aboard: ab.entities.map((e) => ({ key: e.$key, from: e.from.value, to: e.to.value, kind: e.kind.value, chainId: String(e.chainId.value), note: e.note.value })),
        names: nm.entities.map((e) => ({ key: e.$key, name: e.name.value, verdict: e.verdict.value, expiresAt: e.$expiresAt })),
        leaves: lv.entities.map((e) => ({ key: e.$key, owner: e.$owner, root: e.root.value, leaf: String(e.leaf.value), account: e.account.value, digest: e.digest.value.toLowerCase(), tx: e.txHash.value })),
      });
    })().catch((e) => setErr(String(e?.shortMessage ?? e?.message ?? e).slice(0, 200)));
  }, []);

  const twice = data
    ? [...data.leaves.reduce((m, l) => m.set(`${l.root}:${l.leaf}`, (m.get(`${l.root}:${l.leaf}`) ?? new Set<string>()).add(l.digest)), new Map<string, Set<string>>())].filter(([, s]) => s.size > 1)
    : [];

  return (
    <div className="wrap">
      <div className="page-head">
        <span className="eyebrow">Arkiv · public Q-Day registry</span>
        <h2>Harbour: the manifest anyone can check</h2>
        <p>Live from Arkiv. Every entry is signed by its writer and was re-checked on-chain before it was written. Readings expire after 24 hours; the audit trail is readonly, and anyone can keep it alive.</p>
      </div>
      {err && <p className="error-box section">Arkiv is unreachable right now: {err}</p>}
      {!data && !err && (
        <div className="panel section scanning">
          <span className="spinner" /> Reading the registry from Arkiv…
        </div>
      )}
      {data && (
        <div className="grid section">
          <div className={`seal ${twice.length ? "bad" : "good"}`}>
            <Seal good={!twice.length} />
            <div>
              <div className="big">{twice.length ? "A one-time key signed twice" : "No one-time key has signed twice"}</div>
              <div className="muted">
                {twice.length
                  ? `${twice.length} leaf(s) signed two different messages. Those keys can be forged: move the funds now.`
                  : `${data.leaves.length} published uses of one-time keys, from any writer. Each leaf signed exactly one message.`}
              </div>
            </div>
          </div>

          <div className="grid cols-2">
            <div className="panel">
              <h3>Exposed keys</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>Where</th>
                      <th>At risk</th>
                      <th>Valid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.exposed.map((e) => {
                      const l = life(e.expiresAt, data.block, DAY);
                      return (
                        <tr key={e.key}>
                          <td className="mono">{short(e.address)}</td>
                          <td className="muted">{chainName(e.chainId)}</td>
                          <td className="num">{Number(e.eth).toFixed(4)} ETH</td>
                          <td>
                            <ExpiryRing fraction={l.fraction} label={l.label} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="panel">
              <h3>Aboard: verified moves to post-quantum accounts</h3>
              {data.aboard.map((a) => (
                <div key={a.key} className="aboard-item">
                  <span className="ico">🛟</span>
                  <span>
                    <b>{a.kind === "rescue-sweep" ? "Rescue sweep" : a.kind === "ens-handover" ? "ENS handover" : a.kind}</b> <span className="muted">on {chainName(a.chainId)}</span>
                  </span>
                  <span className="route">
                    {short(a.from)} → {short(a.to)}
                  </span>
                </div>
              ))}
              <h3 style={{ marginTop: 18 }}>ENS names</h3>
              {data.names.map((n) => {
                const l = life(n.expiresAt, data.block, DAY);
                return (
                  <div key={n.key} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <Badge status={n.verdict === "protected" ? "ok" : "exposed"}>{n.verdict}</Badge>
                    <b>{n.name}</b>
                    <ExpiryRing fraction={l.fraction} label={l.label} />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel">
            <h3>Logbook: every use of a one-time key</h3>
            <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
              Anyone can write a sighting, for example a watcher that saw a leaf in a mempool. Two different messages for one leaf would turn the seal above red.
            </p>
            <div className="table-wrap">
              <table>
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
                      <td className="mono">{short(l.root)}</td>
                      <td className="num">#{l.leaf}</td>
                      <td className="mono">{short(l.account)}</td>
                      <td className="mono muted">{l.tx.startsWith("0x") ? short(l.tx, 8) : l.tx}</td>
                      <td className="mono muted">{short(l.owner)}</td>
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
    </div>
  );
}
