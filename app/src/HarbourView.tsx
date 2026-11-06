import { useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import { asc, desc, eq, gt } from "@arkiv-network/sdk/query";
import { key as entityKey } from "@arkiv-network/sdk/schema";
import { Aboard, Exposure, Leaf, NameCheck, PUBLISHER } from "@lifeboat/core";
import {
  NAIVE_ACCOUNT,
  REPO,
  arkiv,
  arkivAddressUrl,
  arkivErrorText,
  chainName,
  expiresIn,
  explorerTx,
  isAuditGrade,
  isPublisher,
  isTestAccount,
  newestPer,
  secondsLeft,
  sepoliaTx,
  short,
  swarmUrl,
  writerLabel,
  exposureEvidence,
  type EvidenceRecord,
  type Flags,
} from "./lib";
import { Pill, Ring, Rubber } from "./ui";
import AlertsBoard from "./AlertsBoard";
import EvidenceDrawer, { ArkivLink, EvidenceButton, FlagStamp, TestTag } from "./EvidenceDrawer";

type Exp = { key: string; createdAt: bigint; expiresAt: bigint; address: string; chainId: string; eth: string; via: string; note: string; ev: EvidenceRecord };
type Ab = { key: string; createdAt: bigint; expiresAt: bigint; flags: Flags; from: string; to: string; kind: string; chainId: string; note: string; txHash: string; ev?: EvidenceRecord };
type Nm = { key: string; createdAt: bigint; expiresAt: bigint; name: string; chainId: string; verdict: string; block: string; ev?: EvidenceRecord };
type Lf = { key: string; owner: string; flags: Flags; expiresAt: bigint; root: string; leaf: string; account: string; digest: string; tx: string };
type Data = {
  block: bigint;
  exposed: Exp[];
  exposedRecords: bigint;
  exposedCapped: boolean;
  aboard: Ab[];
  aboardTotal: bigint;
  names: Nm[];
  nameRecords: bigint;
  namesCapped: boolean;
};

const DAY = 86400;
const LEAF_PAGE = 100;
const ring = (expiresAt: bigint, block: bigint) => ({ fraction: secondsLeft(expiresAt, block) / DAY, label: expiresIn(expiresAt, block) });
const txUrl = (chainId: string, h: string) => (!/^0x[0-9a-f]{64}$/i.test(h) ? null : chainId === "11155111" ? sepoliaTx(h) : chainId === "1337" ? explorerTx(h) : null);

/** One page of the open-write leaf ledger, by entity key (keyset paging: stable while others write). */
const leafPage = (after?: string) => {
  const q = arkiv
    .select({ $key: true, $owner: true, $creationFlags: true, $expiresAt: true, root: true, leaf: true, account: true, digest: true, txHash: true })
    .from(Leaf)
    .withCount()
    .orderBy(asc("$key"))
    .limit(LEAF_PAGE);
  return (after ? q.where(gt("$key", entityKey(after as Hex))) : q).fetch();
};
const leafRows = (page: Awaited<ReturnType<typeof leafPage>>): Lf[] =>
  page.entities.map((e) => ({
    key: e.$key,
    owner: e.$owner,
    flags: e.$creationFlags,
    expiresAt: e.$expiresAt,
    root: e.root.value,
    leaf: String(e.leaf.value),
    account: e.account.value,
    digest: e.digest.value.toLowerCase(),
    tx: e.txHash.value,
  }));

export default function HarbourView() {
  const [data, setData] = useState<Data | null>(null);
  const [leaves, setLeaves] = useState<{ rows: Lf[]; total: bigint; block: bigint; more: boolean; loading: boolean } | null>(null);
  const [err, setErr] = useState("");
  const [sort, setSort] = useState<"risk" | "newest">("risk");
  const [ev, setEv] = useState<{ ref: string; records: EvidenceRecord[]; title: string } | null>(null);
  const [attempt, setAttempt] = useState(0); // "try again" reads Arkiv again, without a page reload

  useEffect(() => {
    let live = true;
    setErr("");
    (async () => {
      const [ex, ab, nm, lv] = await Promise.all([
        arkiv
          .select({ $key: true, $createdAt: true, $expiresAt: true, address: true, chainId: true, ethAtRisk: true, via: true, evidence: true, status: true, checkedBlock: true, swarmRef: true, evidenceHash: true })
          .from(Exposure)
          .withCount()
          .where(eq("status", "exposed"))
          .ownedBy(PUBLISHER)
          .orderBy(desc("$expiresAt"))
          .limit(100)
          .fetch(),
        arkiv
          .select({ $key: true, $createdAt: true, $expiresAt: true, $creationFlags: true, from: true, to: true, kind: true, chainId: true, note: true, txHash: true, swarmRef: true, evidenceHash: true })
          .from(Aboard)
          .withCount()
          .ownedBy(PUBLISHER)
          .orderBy(desc("$expiresAt"))
          .limit(100)
          .fetch(),
        arkiv
          .select({ $key: true, $createdAt: true, $expiresAt: true, name: true, chainId: true, verdict: true, checkedBlock: true, swarmRef: true, evidenceHash: true })
          .from(NameCheck)
          .withCount()
          .ownedBy(PUBLISHER)
          .orderBy(desc("$expiresAt"))
          .limit(100)
          .fetch(),
        leafPage(),
      ]);
      if (!live) return;
      const exposed = ex.entities.map((e) => ({
        key: e.$key,
        createdAt: e.$createdAt,
        expiresAt: e.$expiresAt,
        address: e.address.value,
        chainId: String(e.chainId.value),
        eth: e.ethAtRisk.value,
        via: e.via.value,
        note: e.evidence.value,
        ev: exposureEvidence(e.$key, e),
      }));
      const names = nm.entities.map((e) => ({
        key: e.$key,
        createdAt: e.$createdAt,
        expiresAt: e.$expiresAt,
        name: e.name.value,
        chainId: String(e.chainId.value),
        verdict: e.verdict.value,
        block: String(e.checkedBlock.value),
        ev: e.swarmRef ? { key: e.$key, kind: "name" as const, swarmRef: e.swarmRef.value, evidenceHash: e.evidenceHash?.value, name: e.name.value, verdict: e.verdict.value, block: String(e.checkedBlock.value) } : undefined,
      }));
      setData({
        block: ex.blockNumber,
        exposed: newestPer(exposed, (r) => `${r.address.toLowerCase()}:${r.chainId}`),
        exposedRecords: ex.count,
        exposedCapped: BigInt(ex.entities.length + ex.skipped) < ex.count,
        // readonly records can't be updated, so a move re-published with its evidence has two records: show one per tx
        aboard: onePerMove(ab.entities.map((e) => ({
          key: e.$key,
          createdAt: e.$createdAt,
          expiresAt: e.$expiresAt,
          flags: e.$creationFlags,
          from: e.from.value,
          to: e.to.value,
          kind: e.kind.value,
          chainId: String(e.chainId.value),
          note: e.note.value,
          txHash: e.txHash.value,
          ev: e.swarmRef ? { key: e.$key, kind: "aboard" as const, swarmRef: e.swarmRef.value, evidenceHash: e.evidenceHash?.value, txHash: e.txHash.value } : undefined,
        }))),
        aboardTotal: ab.count,
        names: newestPer(names, (r) => `${r.name}:${r.chainId}`),
        nameRecords: nm.count,
        namesCapped: BigInt(nm.entities.length + nm.skipped) < nm.count,
      });
      setLeaves({ rows: leafRows(lv), total: lv.count, block: lv.blockNumber, more: lv.entities.length + lv.skipped >= LEAF_PAGE, loading: false });
    })().catch((e) => live && setErr(arkivErrorText(e)));
    return () => {
      live = false;
    };
  }, [attempt]);

  const loadMore = () => {
    if (!leaves || leaves.loading) return;
    const last = leaves.rows.at(-1)?.key;
    if (!last) return;
    setLeaves({ ...leaves, loading: true });
    leafPage(last)
      .then((p) => setLeaves((l) => l && { ...l, rows: [...l.rows, ...leafRows(p)], block: p.blockNumber, more: p.entities.length > 0 && p.entities.length + p.skipped >= LEAF_PAGE, loading: false }))
      .catch(() => setLeaves((l) => l && { ...l, loading: false }));
  };

  // A one-time key "signed twice": one (root, leaf) with more than one digest, across every loaded sighting.
  const twice = useMemo(() => {
    if (!leaves) return [];
    const by = new Map<string, Lf[]>();
    for (const l of leaves.rows) by.set(`${l.root}:${l.leaf}`, [...(by.get(`${l.root}:${l.leaf}`) ?? []), l]);
    return [...by].map(([k, ls]) => ({ k, ls, digests: new Set(ls.map((l) => l.digest)).size })).filter((x) => x.digests > 1);
  }, [leaves]);
  const exposed = useMemo(() => (data ? [...data.exposed].sort((a, b) => (sort === "risk" ? Number(b.eth) - Number(a.eth) : Number(b.createdAt - a.createdAt))) : []), [data, sort]);

  // The lead's claim about the audit trail, read from each entry's creation flags.
  const audit = useMemo(() => {
    if (!data || !leaves) return null;
    const flags = [...data.aboard.map((a) => a.flags), ...leaves.rows.map((l) => l.flags)];
    return { total: flags.length, sealed: flags.filter(isAuditGrade).length };
  }, [data, leaves]);

  const openEv = (r: EvidenceRecord, title: string) => setEv({ ref: r.swarmRef, records: [r], title });

  return (
    <>
      <section className="section" style={{ marginTop: 26 }}>
        <div className="label">Arkiv · the public Q-Day registry</div>
        <h2>
          Harbour <span className="o">manifest</span>
        </h2>
        <p className="lead">
          Live from Arkiv. Every entry is signed by its writer and was re-checked on-chain before it was written. Readings expire after 24 hours.{" "}
          {audit &&
            (audit.sealed === audit.total ? (
              <>
                All {audit.total} audit entries are readonly, and anyone can keep them alive: read from each entry's creation flags.
              </>
            ) : (
              <>
                {audit.sealed} of {audit.total} audit entries are readonly and open to anyone to extend, read from each entry's creation flags.
              </>
            ))}
        </p>
      </section>
      {err && (
        <p className="error-box">
          Arkiv didn't answer: {err}{" "}
          <button className="link-btn" onClick={() => setAttempt((n) => n + 1)}>
            try again
          </button>
        </p>
      )}
      {!data && !err && <p className="note">Reading the registry from Arkiv…</p>}
      {data && leaves && (
        <div className="grid">
          <div className={`seal ${twice.length ? "bad" : "good"}`}>
            <Rubber good={!twice.length}>{twice.length ? "Signed twice" : "All clear"}</Rubber>
            <div>
              <div className="big">{twice.length ? "A one-time key signed twice" : "No one-time key has signed twice"}</div>
              <div className="muted">
                {twice.length
                  ? `${twice.length} leaf(s) signed more than one message. Those keys can be forged: move the funds now.`
                  : `${leaves.rows.length} published uses of one-time keys, from any writer. Each one signed exactly one message.`}
                {leaves.more ? ` Checked ${leaves.rows.length} of ${leaves.total} uses: load more below to check the rest.` : ""}
              </div>
              {twice.map(({ k, ls, digests }) => {
                const [root, leaf] = k.split(":");
                const acct = ls[0]?.account ?? "";
                const ours = ls.filter((l) => isPublisher(l.owner)).length;
                return (
                  <div key={k} className="mono" style={{ marginTop: 6, fontSize: 13 }}>
                    ⚠ key {short(root ?? "")} leaf #{leaf}: <b>{digests} different messages</b> · account {short(acct)} <TestTag account={acct} />
                    {acct.toLowerCase() === NAIVE_ACCOUNT.toLowerCase() && " (the naive-wallet forgery demo)"}
                    <div className="note">{ours === ls.length ? `all ${ls.length} sightings from the Lifeboat publisher` : `${ours} of ${ls.length} sightings from the Lifeboat publisher, ${ls.length - ours} from other writers`}</div>
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
              <div className="board-sub">
                <span>
                  {exposed.length}
                  {data.exposedCapped ? "+" : ""} keys · newest reading each
                </span>
                <span style={{ marginLeft: "auto" }}>{String(data.exposedRecords)} readings on Arkiv</span>
              </div>
              <div className="table-wrap">
                <table className="manifest">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Where</th>
                      <th>Cargo</th>
                      <th>Valid</th>
                      <th>Record</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exposed.map((e) => {
                      const l = ring(e.expiresAt, data.block);
                      return (
                        <tr key={e.key}>
                          <td className="m">
                            {short(e.address)} <TestTag account={e.address} />
                            {e.via === "safe-signature" && <div className="note">{e.note.split(":")[0]}</div>}
                          </td>
                          <td>{chainName(e.chainId)}</td>
                          <td className="m" style={{ whiteSpace: "nowrap" }}>
                            {Number(e.eth).toFixed(4)} ETH
                          </td>
                          <td>
                            <Ring fraction={l.fraction} label={l.label} />
                          </td>
                          <td>
                            <div className="rec-meta">
                              <ArkivLink entityKey={e.key} />
                              {e.ev.swarmRef && (
                                <>
                                  <a className="arkiv-link" href={swarmUrl(e.ev.swarmRef)} target="_blank" rel="noreferrer">
                                    Swarm ↗
                                  </a>
                                  <EvidenceButton onOpen={() => openEv(e.ev, `Exposure · ${short(e.address)} on ${chainName(e.chainId)}`)} />
                                </>
                              )}
                            </div>
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
              <div className="board-sub">
                <span>{data.aboard.length} moves · {String(data.aboardTotal)} records on Arkiv</span>
              </div>
              {data.aboard.map((a) => {
                const tx = txUrl(a.chainId, a.txHash);
                return (
                  <div className="board-row" key={a.key} style={{ display: "block" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span>🛟</span>
                      <b>{a.kind === "rescue-sweep" ? "Rescue sweep" : a.kind === "ens-handover" ? "ENS handover" : a.kind}</b>
                      <span className="note">on {chainName(a.chainId)}</span>
                      <span style={{ marginLeft: "auto" }}>
                        <FlagStamp flags={a.flags} />
                      </span>
                    </div>
                    <div className="mono muted" style={{ marginTop: 2 }}>
                      {short(a.from)} → {short(a.to)} <TestTag account={isTestAccount(a.from) ? a.from : a.to} />
                    </div>
                    <div className="rec-meta" style={{ marginTop: 4 }}>
                      <span>{expiresIn(a.expiresAt, data.block)}</span>
                      <ArkivLink entityKey={a.key} />
                      {tx && (
                        <a className="arkiv-link" href={tx} target="_blank" rel="noreferrer">
                          tx ↗
                        </a>
                      )}
                      {a.ev && <EvidenceButton onOpen={() => openEv(a.ev!, `Aboard · ${a.kind} on ${chainName(a.chainId)}`)} />}
                    </div>
                  </div>
                );
              })}
              <div className="board-head" style={{ borderTop: "3px solid var(--ink)" }}>
                <h3>Names</h3>
                <span className="label">ENS Helm check verdicts</span>
              </div>
              <div className="board-sub">
                <span>
                  {data.names.length}
                  {data.namesCapped ? "+" : ""} names · newest verdict each
                </span>
                <span style={{ marginLeft: "auto" }}>{String(data.nameRecords)} readings on Arkiv</span>
              </div>
              {data.names.map((n) => {
                const l = ring(n.expiresAt, data.block);
                return (
                  <div className="board-row" key={n.key} style={{ flexWrap: "wrap" }}>
                    <Pill status={n.verdict === "protected" ? "pq" : n.verdict === "unknown" ? "not-seen" : "exposed"}>{n.verdict}</Pill>
                    <b>{n.name}</b>
                    <TestTag name={n.name} />
                    <span style={{ marginLeft: "auto" }}>
                      <Ring fraction={l.fraction} label={l.label} />
                    </span>
                    <div className="rec-meta" style={{ flexBasis: "100%" }}>
                      <span>block {Number(n.block).toLocaleString("en-US")}</span>
                      <ArkivLink entityKey={n.key} />
                      {n.ev && (
                        <>
                          <a className="arkiv-link" href={swarmUrl(n.ev.swarmRef)} target="_blank" rel="noreferrer">
                            Swarm ↗
                          </a>
                          <EvidenceButton onOpen={() => openEv(n.ev!, `Helm check · ${n.name}`)} />
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <AlertsBoard />

          <div className="board">
            <div className="board-head">
              <h3>Logbook</h3>
              <span className="label">every use of a one-time key · anyone can report a sighting</span>
            </div>
            <div className="board-sub">
              <span>
                {leaves.rows.length} of {String(leaves.total)} uses · by entry key
              </span>
              <span style={{ marginLeft: "auto" }}>{leaves.rows.filter((l) => !isPublisher(l.owner)).length} from other writers</span>
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
                    <th>Entry</th>
                  </tr>
                </thead>
                <tbody>
                  {leaves.rows.map((l) => (
                    <tr key={l.key}>
                      <td className="m">{short(l.root)}</td>
                      <td className="m">#{l.leaf}</td>
                      <td className="m">
                        {short(l.account)} <TestTag account={l.account} />
                      </td>
                      <td className="m">{l.tx.startsWith("0x") ? short(l.tx, 8) : l.tx}</td>
                      <td>
                        <span className={`writer ${isPublisher(l.owner) ? "ours" : "other"}`} title={l.owner}>
                          {writerLabel(l.owner)}
                        </span>
                      </td>
                      <td>
                        <div className="rec-meta">
                          <FlagStamp flags={l.flags} />
                          <span>{expiresIn(l.expiresAt, leaves.block)}</span>
                          <ArkivLink entityKey={l.key} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {leaves.more && (
              <div className="board-note">
                <button type="button" className="more-btn" disabled={leaves.loading} onClick={loadMore}>
                  {leaves.loading ? "Loading…" : "Load more"}
                </button>{" "}
                <span className="note">next {LEAF_PAGE}, after entity {short(leaves.rows.at(-1)?.key ?? "", 6)}</span>
              </div>
            )}
          </div>
          <p className="note">
            Arkiv block {data.block.toString()} · writer{" "}
            <a className="mono" href={arkivAddressUrl(PUBLISHER)} target="_blank" rel="noreferrer">
              {PUBLISHER}
            </a>{" "}
            · <a href={`${REPO}/blob/main/arkiv/schema.md`}>schema</a> · <a href={`${REPO}/blob/main/scripts/arkiv-query-public.mjs`}>run a query yourself</a>
          </p>
        </div>
      )}
      {ev && <EvidenceDrawer swarmRef={ev.ref} records={ev.records} title={ev.title} onClose={() => setEv(null)} />}
    </>
  );
}

/** One row per move (txHash): the record with evidence wins, then the newest. */
function onePerMove<T extends { txHash: string; createdAt: bigint; ev?: unknown }>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const cur = best.get(r.txHash);
    if (!cur || (!!r.ev && !cur.ev) || (!!r.ev === !!cur.ev && r.createdAt > cur.createdAt)) best.set(r.txHash, r);
  }
  return [...best.values()];
}
