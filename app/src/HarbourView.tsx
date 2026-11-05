import { useEffect, useState } from "react";
import { desc, eq } from "@arkiv-network/sdk/query";
import { ARKIV_BLOCK_SECONDS, Aboard, Exposure, Leaf, NameCheck, PUBLISHER } from "@lifeboat/core";
import { REPO, arkiv, short } from "./lib";

type Data = {
  block: bigint;
  exposed: { key: string; address: string; chainId: string; eth: string; via: string; expiresAt: bigint }[];
  aboard: { key: string; from: string; to: string; kind: string; chainId: string }[];
  names: { key: string; name: string; verdict: string; expiresAt: bigint }[];
  leaves: { key: string; owner: string; root: string; leaf: string; account: string; digest: string; tx: string }[];
};

const left = (expiresAt: bigint, block: bigint) => {
  const s = Number(expiresAt - block) * ARKIV_BLOCK_SECONDS;
  return s <= 0 ? "expired" : s > 86400 * 2 ? `${Math.round(s / 86400)} days left` : `${(s / 3600).toFixed(1)} h left`;
};

export default function HarbourView() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const [block, ex, ab, nm, lv] = await Promise.all([
        arkiv.getBlockNumber(),
        arkiv.select({ $key: true, $expiresAt: true, address: true, chainId: true, ethAtRisk: true, via: true }).from(Exposure).where(eq("status", "exposed")).ownedBy(PUBLISHER).orderBy(desc("ethAtRisk")).limit(50).fetch(),
        arkiv.select({ $key: true, from: true, to: true, kind: true, chainId: true }).from(Aboard).ownedBy(PUBLISHER).limit(50).fetch(),
        arkiv.select({ $key: true, $expiresAt: true, name: true, verdict: true }).from(NameCheck).ownedBy(PUBLISHER).limit(50).fetch(),
        arkiv.select({ $key: true, $owner: true, root: true, leaf: true, account: true, digest: true, txHash: true }).from(Leaf).limit(100).fetch(),
      ]);
      setData({
        block,
        exposed: ex.entities.map((e) => ({ key: e.$key, address: e.address.value, chainId: String(e.chainId.value), eth: e.ethAtRisk.value, via: e.via.value, expiresAt: e.$expiresAt })),
        aboard: ab.entities.map((e) => ({ key: e.$key, from: e.from.value, to: e.to.value, kind: e.kind.value, chainId: String(e.chainId.value) })),
        names: nm.entities.map((e) => ({ key: e.$key, name: e.name.value, verdict: e.verdict.value, expiresAt: e.$expiresAt })),
        leaves: lv.entities.map((e) => ({ key: e.$key, owner: e.$owner, root: e.root.value, leaf: String(e.leaf.value), account: e.account.value, digest: e.digest.value.toLowerCase(), tx: e.txHash.value })),
      });
    })().catch((e) => setErr(String(e?.shortMessage ?? e?.message ?? e).slice(0, 200)));
  }, []);

  const twice = data
    ? [...data.leaves.reduce((m, l) => m.set(`${l.root}:${l.leaf}`, (m.get(`${l.root}:${l.leaf}`) ?? new Set<string>()).add(l.digest)), new Map<string, Set<string>>())].filter(([, s]) => s.size > 1)
    : [];

  return (
    <section>
      <h2>Harbour: the public Q-Day registry</h2>
      <p className="sub">
        Live from Arkiv. Every entry is signed by its writer ("vouched by") and was re-checked on-chain before it was written. Exposure readings expire after 24 hours; audit-trail entries are readonly.
      </p>
      {err && <p className="error-box">Arkiv is unreachable right now: {err}</p>}
      {!data && !err && (
        <div className="card">
          <span className="spinner" /> Reading Arkiv…
        </div>
      )}
      {data && (
        <div className="grid">
          <div className={`verdict ${twice.length ? "bad" : "good"}`}>
            <span className="big">{twice.length ? "Signed twice!" : "No one-time key reused"}</span>
            <span className="detail">
              {twice.length
                ? `${twice.length} leaf(s) signed two different messages: those keys can be forged`
                : `${data.leaves.length} published leaf uses, from any writer: none signed two different messages`}
            </span>
          </div>
          <div className="grid two">
            <div className="card">
              <h3>Exposed keys</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>Chain</th>
                      <th>At risk</th>
                      <th>Valid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.exposed.map((e) => (
                      <tr key={e.key}>
                        <td className="mono">{short(e.address)}</td>
                        <td>{e.chainId}</td>
                        <td className="num">{Number(e.eth).toFixed(4)} ETH</td>
                        <td className="note">{left(e.expiresAt, data.block)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card">
              <h3>Aboard (verified moves to post-quantum accounts)</h3>
              {data.aboard.map((a) => (
                <div key={a.key} style={{ marginBottom: 8 }}>
                  🛟 <b>{a.kind}</b> on chain {a.chainId}
                  <div className="mono note">
                    {short(a.from)} → {short(a.to)}
                  </div>
                </div>
              ))}
              <h3 style={{ marginTop: 14 }}>ENS names</h3>
              {data.names.map((n) => (
                <div key={n.key}>
                  <span className={`badge ${n.verdict === "protected" ? "ok" : "exposed"}`}>{n.verdict}</span> {n.name} <span className="note">({left(n.expiresAt, data.block)})</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h3>Leaf ledger</h3>
            <p className="note">Every use of a one-time key. Anyone can publish a sighting, e.g. a watcher that saw a leaf in a mempool.</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Leaf</th>
                    <th>Account</th>
                    <th>Where</th>
                    <th>Reported by</th>
                  </tr>
                </thead>
                <tbody>
                  {data.leaves.map((l) => (
                    <tr key={l.key}>
                      <td className="mono">{short(l.root)}</td>
                      <td className="num">{l.leaf}</td>
                      <td className="mono">{short(l.account)}</td>
                      <td className="mono">{l.tx.startsWith("0x") ? short(l.tx) : l.tx}</td>
                      <td className="mono">{short(l.owner)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="note">
            Arkiv block {data.block.toString()} · writer <span className="mono">{PUBLISHER}</span> · <a href={`${REPO}/blob/main/arkiv/schema.md`}>schema</a>
          </p>
        </div>
      )}
    </section>
  );
}
