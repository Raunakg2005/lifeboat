import { useEffect, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { normalize } from "viem/ens";
import { eq } from "@arkiv-network/sdk/query";
import { addr } from "@arkiv-network/sdk/schema";
import { Aboard, Exposure as ExposureSchema, NameCheck, PUBLISHER, checkExposure, helmCheck, type ChainExposure, type HelmReport } from "@lifeboat/core";
import { SEPOLIA_PQ_WALLETS, arkiv, mainnetClient, sepoliaAddr, sepoliaClient, sepoliaLogs, short, swarmUrl } from "./lib";
import { HelmWheel, LuggageTag, Pill, Radar, Rubber, STATUS_FILL, Steps, type SpokeState } from "./ui";

const EXAMPLES = [
  { tag: "name", label: "lifeboatdemo.eth (hijackable)", value: "lifeboatdemo.eth" },
  { tag: "name", label: "lifeboatpq.eth (handed over)", value: "lifeboatpq.eth" },
  { tag: "wallet", label: "exposed dev wallet", value: "0xBAc277e47dd7B95c04BB3517b76c1dd9151A054a" },
  { tag: "wallet", label: "post-quantum wallet", value: "0x2e58B0f2336dFe76b8bbAb1BfD927E354CBC997F" },
];

const PATHS: Record<number, { title: string; why: string }> = {
  1: { title: "Owner", why: "holds the name's token in its parent registry" },
  2: { title: "Delegates", why: "other accounts with roles on the name, such as SET_RESOLVER" },
  3: { title: "Operators", why: "approved for all of the owner's names, so they can move this one" },
  4: { title: "Resolver crew", why: "can rewrite the address and text records; UPGRADE can swap the resolver's code" },
  5: { title: "Port authority", why: "admins of the registries above the name: systemic, outside the owner's control" },
};
const HELM_STEPS = ["Finding the registry that holds the name", "Rebuilding every role list from the logs (5 paths in parallel)", "Classifying every key and proving the lists complete"];

type Query = { kind: "name" | "address"; value: string };
type Tab = "check" | "discover" | "escape" | "harbour";

export default function CheckView({ onGo }: { onGo: (t: Tab) => void }) {
  const [mode, setMode] = useState<"address" | "name">("name");
  const [input, setInput] = useState("lifeboatdemo.eth");
  const [query, setQuery] = useState<Query | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = (raw: string) => {
    const v = raw.trim();
    setError("");
    if (isAddress(v, { strict: false })) {
      setMode("address");
      setQuery({ kind: "address", value: getAddress(v) });
      setBusy(true);
    } else if (/^[^\s]+\.[a-z]+$/i.test(v)) {
      try {
        setMode("name");
        setQuery({ kind: "name", value: normalize(v) });
        setBusy(true);
      } catch {
        setError("That doesn't look like a valid ENS name.");
      }
    } else setError("Enter an Ethereum address (0x…) or an ENSv2 name (name.eth).");
  };

  return (
    <>
      <section className="hero">
        <div>
          <h1>
            Abandon
            <br />
            ECDSA<span className="o">.</span>
          </h1>
          <p className="lede">
            A future quantum computer can take over any wallet whose public key is on-chain, and every signature puts it there. Check who could take over your wallet or your name, then get off before
            Q-Day.
          </p>
          <div className="toggle" role="group" aria-label="What to check">
            <button aria-pressed={mode === "name"} onClick={() => (setMode("name"), setInput("lifeboatdemo.eth"))}>
              ENS name
            </button>
            <button aria-pressed={mode === "address"} onClick={() => (setMode("address"), setInput("0xBAc277e47dd7B95c04BB3517b76c1dd9151A054a"))}>
              Address
            </button>
          </div>
          <form
            className="passenger"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <span className="tag">{mode === "name" ? "Vessel" : "Passenger"}</span>
            <input aria-label="Address or ENS name" value={input} onChange={(e) => setInput(e.target.value)} placeholder={mode === "name" ? "name.eth" : "0x…"} spellCheck={false} autoComplete="off" />
            <button type="submit" disabled={busy}>
              {busy ? "Scanning" : mode === "name" ? "Helm check" : "Check manifest"}
            </button>
          </form>
          <div className="hint">
            {mode === "name"
              ? "Any ENSv2 name on Sepolia: every key that can steer it, across all five control paths."
              : "Checks Ethereum, Base, Arbitrum, Optimism, Polygon, Sepolia. Read-only: Lifeboat never asks for a key or a signature."}
          </div>
          <div className="examples">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.value}
                type="button"
                onClick={() => {
                  setInput(ex.value);
                  submit(ex.value);
                }}
              >
                <b>{ex.tag}</b> {ex.label}
              </button>
            ))}
          </div>
          {error && (
            <p className="error-box" role="alert" style={{ maxWidth: 680 }}>
              {error}
            </p>
          )}
          <div className="warning">No quantum computer can do this today. These are readiness findings from public on-chain data.</div>
        </div>
        <RegistryBoard onGo={onGo} />
      </section>

      <div className="section">
        {query?.kind === "name" && <HelmPanel key={query.value} name={query.value} onDone={() => setBusy(false)} />}
        {query?.kind === "address" && <AddressPanel key={query.value} address={query.value as Address} onDone={() => setBusy(false)} />}
      </div>
    </>
  );
}

/** Right-hand board: live counts from the public Q-Day registry on Arkiv. */
function RegistryBoard({ onGo }: { onGo: (t: Tab) => void }) {
  const [d, setD] = useState<{ exposed: number; aboard: number; names: number; newest: { a: string; kind: string }[] } | null>(null);
  useEffect(() => {
    Promise.all([
      arkiv.select({ $key: true }).from(ExposureSchema).where(eq("status", "exposed")).ownedBy(PUBLISHER).limit(100).fetch(),
      arkiv.select({ $key: true, from: true, kind: true }).from(Aboard).ownedBy(PUBLISHER).limit(100).fetch(),
      arkiv.select({ $key: true }).from(NameCheck).ownedBy(PUBLISHER).limit(100).fetch(),
    ])
      .then(([e, a, n]) => setD({ exposed: e.entities.length, aboard: a.entities.length, names: n.entities.length, newest: a.entities.slice(0, 3).map((x) => ({ a: x.from.value, kind: x.kind.value })) }))
      .catch(() => setD({ exposed: 0, aboard: 0, names: 0, newest: [] }));
  }, []);
  return (
    <aside className="board">
      <div className="board-head">
        <h3>
          Harbour
          <br />
          manifest
        </h3>
        <span className="label">public · on Arkiv</span>
      </div>
      <div className="stats">
        <div>
          <div className="label">Exposed</div>
          <div className="v">{d ? d.exposed : "…"}</div>
        </div>
        <div>
          <div className="label">Aboard</div>
          <div className="v green">{d ? d.aboard : "…"}</div>
        </div>
        <div>
          <div className="label">Names</div>
          <div className="v ink">{d ? d.names : "…"}</div>
        </div>
      </div>
      {d?.newest.map((n) => (
        <div className="board-row" key={n.a + n.kind}>
          <span className="sq" style={{ background: "#1d8a5b" }} />
          <span className="mono">{short(n.a)}</span>
          <span className="note" style={{ marginLeft: "auto" }}>
            {n.kind === "rescue-sweep" ? "rescued" : n.kind === "ens-handover" ? "name handed over" : n.kind}
          </span>
        </div>
      ))}
      <div className="board-note">
        Every entry is re-checked on-chain before it's written, signed by its writer, and expires after 24 hours unless it's an audit record.{" "}
        <a href="#harbour" onClick={() => onGo("harbour")}>
          Open the manifest →
        </a>
      </div>
    </aside>
  );
}

function spokeFill(report: HelmReport, path: number) {
  const es = report.entries.filter((e) => e.path === path);
  if (!es.length) return STATUS_FILL.none!;
  for (const s of ["exposed", "not-seen", "contract", "pq-wallet"]) if (es.some((e) => e.holder.exposure === s)) return STATUS_FILL[s]!;
  return STATUS_FILL.none!;
}

function HelmPanel({ name, onDone }: { name: string; onDone: () => void }) {
  const [report, setReport] = useState<HelmReport | null>(null);
  const [err, setErr] = useState("");
  const [step, setStep] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [published, setPublished] = useState<{ verdict: string; block: string; key: string; swarmRef?: string }[] | null>(null);
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    let live = true;
    const t0 = Date.now();
    helmCheck(sepoliaClient, sepoliaLogs, [mainnetClient], name, { pqWallets: SEPOLIA_PQ_WALLETS, onStep: (s) => live && setStep(Math.max(0, HELM_STEPS.indexOf(s))) })
      .then((r) => live && (setReport(r), setSecs((Date.now() - t0) / 1000)))
      .catch((e) => live && setErr(String(e?.shortMessage ?? e?.message ?? e).slice(0, 240)))
      .finally(() => live && onDone());
    arkiv
      .select({ $key: true, verdict: true, checkedBlock: true, swarmRef: true })
      .from(NameCheck)
      .where(eq("name", name))
      .limit(5)
      .fetch()
      .then((res) => live && setPublished(res.entities.map((e) => ({ verdict: e.verdict.value, block: String(e.checkedBlock.value), key: e.$key, swarmRef: e.swarmRef?.value }))))
      .catch(() => live && setPublished([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  if (err)
    return (
      <div className="error-box">
        Couldn't check <b>{name}</b> on Sepolia ENSv2: {err}. Is it registered in ENSv2 on Sepolia? v1-only names aren't covered yet.
      </div>
    );
  if (!report)
    return (
      <div className="board loading">
        <Radar />
        <div>
          <div className="stencil" style={{ fontSize: 30 }}>
            Helm check: {name}
          </div>
          <Steps steps={HELM_STEPS} current={step} />
        </div>
      </div>
    );

  const tone = report.verdict === "hijackable" ? "bad" : report.verdict === "protected" ? "good" : "unknown";
  const spokes: SpokeState[] = [1, 2, 3, 4, 5].map((p) => ({ path: p, label: PATHS[p]!.title, fill: spokeFill(report, p) }));
  const keys = new Set(report.entries.map((e) => e.holder.address)).size;

  return (
    <div className="grid">
      <LuggageTag
        tone={tone}
        verdict={tone === "bad" ? "Hijackable" : tone === "good" ? "Protected" : "Unknown"}
        id={report.name}
        meta={`${keys} keys at the helm · Sepolia block ${report.block.toString()} · ${secs.toFixed(1)} s`}
      >
        <p className="desc">
          {tone === "bad" ? (
            <>
              On Q-Day this name can be steered through path{report.hijackablePaths.length > 1 ? "s" : ""} <b>{report.hijackablePaths.join(", ")}</b> by keys whose public keys are already on-chain.
            </>
          ) : tone === "good" ? (
            <>No exposed key steers this name. Its owner and every resolver role sit with a post-quantum wallet{report.systemicExposed ? "; the port authority (path 5) is systemic and shown for the record" : ""}.</>
          ) : (
            <>The role list couldn't be proven complete, so we won't call it safe.</>
          )}
        </p>
        <div className="helm">
          <HelmWheel spokes={spokes} active={active} onSelect={(p) => setActive(p === active ? null : p)} center={report.name} />
          <div>
            {[1, 2, 3, 4, 5].map((p) => {
              const es = report.entries.filter((e) => e.path === p);
              return (
                <div key={p} className={`path ${active === p ? "active" : ""}`} onMouseEnter={() => setActive(p)}>
                  <div className="head">
                    <span className="n" style={{ background: spokeFill(report, p), color: spokeFill(report, p) === STATUS_FILL.pq ? "#fff" : undefined }}>
                      {p}
                    </span>
                    <span className="t">{PATHS[p]!.title}</span>
                    <span className="count">{es.length ? `${es.length} key${es.length > 1 ? "s" : ""}` : "nobody"}</span>
                  </div>
                  <div className="why">{PATHS[p]!.why}</div>
                  {es.length === 0 && <div className="nobody">✓ nobody holds this path</div>}
                  {es.map((e, i) => (
                    <div className="holder" key={i}>
                      <Pill status={e.holder.exposure} />
                      <a href={sepoliaAddr(e.holder.address)} target="_blank" rel="noreferrer">
                        {e.holder.address}
                      </a>
                      <div className="roles">
                        {e.power.length > 6 ? `${e.power.slice(0, 6).join(", ")} +${e.power.length - 6} more` : e.power.join(", ")} · {e.holder.detail}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </LuggageTag>

      <div className="grid cols-2">
        <div className="paper-card">
          <h3>Is the crew list complete?</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            ENSv2 stores only role <i>counts</i> on-chain. We rebuild every holder from the logs, then check that their role bitmaps add up to the on-chain <span className="mono">roleCount</span>. One missing
            holder and the verdict is "unknown", never a false "protected".
          </p>
          {report.completeness.map((c, i) => (
            <div key={i} style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <Rubber good={c.complete}>{c.complete ? "Proven complete" : "Mismatch"}</Rubber>
              <span className="mono muted">{c.where.replace(/0x[0-9a-fA-F]{40}/, (m) => short(m))}</span>
            </div>
          ))}
        </div>
        <div className="paper-card">
          <h3>Logged in the public registry</h3>
          {published === null ? (
            <p className="note">reading Arkiv…</p>
          ) : published.length === 0 ? (
            <p className="note">No published verdict for this name yet.</p>
          ) : (
            published.map((p) => (
              <div key={p.key} style={{ marginTop: 8 }}>
                <Pill status={p.verdict === "protected" ? "pq" : "exposed"}>{p.verdict}</Pill> <span className="muted">at Sepolia block {p.block}</span>
                <div className="note mono">
                  Arkiv entity {short(p.key, 8)}
                  {p.swarmRef && (
                    <>
                      {" · "}
                      <a href={swarmUrl(p.swarmRef)} target="_blank" rel="noreferrer">
                        full report on Swarm ↗
                      </a>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function AddressPanel({ address, onDone }: { address: Address; onDone: () => void }) {
  const [rows, setRows] = useState<ChainExposure[] | null>(null);
  const [records, setRecords] = useState<{ ico: string; text: string }[] | null>(null);

  useEffect(() => {
    let live = true;
    checkExposure(address)
      .then((r) => live && setRows(r))
      .finally(() => live && onDone());
    Promise.all([
      arkiv.select({ $key: true, status: true, chainId: true, via: true }).from(ExposureSchema).where(eq("address", addr(address))).limit(10).fetch(),
      arkiv.select({ $key: true, from: true, to: true, kind: true }).from(Aboard).where(eq("from", addr(address))).limit(10).fetch(),
      arkiv.select({ $key: true, from: true, to: true, kind: true }).from(Aboard).where(eq("to", addr(address))).limit(10).fetch(),
    ])
      .then(([ex, outgoing, incoming]) => {
        if (!live) return;
        setRecords([
          ...ex.entities.map((e) => ({ ico: "📌", text: `${e.status.value} on chain ${e.chainId.value} (found via ${e.via.value})` })),
          ...outgoing.entities.map((e) => ({ ico: "🛟", text: `moved to post-quantum account ${short(e.to.value)} (${e.kind.value})` })),
          ...incoming.entities.map((e) => ({ ico: "🛟", text: `is a post-quantum account; received from ${short(e.from.value)} (${e.kind.value})` })),
        ]);
      })
      .catch(() => live && setRecords([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  if (!rows)
    return (
      <div className="board loading">
        <Radar />
        <div>
          <div className="stencil" style={{ fontSize: 30 }}>
            Checking {short(address)}
          </div>
          <div className="note">six networks, read-only</div>
        </div>
      </div>
    );
  const exposed = rows.filter((r) => r.status === "exposed");
  const contract = rows.some((r) => r.status === "contract");
  const tone = exposed.length ? "bad" : contract ? "neutral" : "good";
  return (
    <LuggageTag tone={tone} verdict={exposed.length ? "Exposed" : contract ? "Contract" : "Not seen"} id={short(address, 6)} meta={exposed.length ? `exposed on ${exposed.length} of ${rows.length} networks` : `checked ${rows.length} networks`}>
      <p className="desc">
        {exposed.length
          ? "This key has signed transactions, so its public key is on-chain. A large enough quantum computer could derive the private key, on every chain it controls."
          : contract
            ? "This is a contract: who controls it depends on its owners and admins."
            : "No transactions from this key on these networks. Signatures elsewhere (multisig approvals, votes, orders) can still reveal it."}
      </p>
      <div className="table-wrap">
        <table className="manifest">
          <thead>
            <tr>
              <th>Network</th>
              <th>Sent</th>
              <th>Cargo</th>
              <th>Lock</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.chain.id}>
                <td className="b">{r.chain.name}</td>
                <td className="m">{r.status === "error" ? "?" : r.nonce}</td>
                <td className="m">{r.status === "error" ? "?" : `${Number(r.balance).toFixed(4)} ${r.chain.symbol}`}</td>
                <td className="m">{r.isContract ? "contract" : "ECDSA"}</td>
                <td>
                  <Pill status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 14, borderTop: "2px solid var(--ink)", paddingTop: 10 }}>
        <div className="label" style={{ marginBottom: 6 }}>
          Public registry (Arkiv)
        </div>
        {records === null ? (
          <span className="note">reading Arkiv…</span>
        ) : records.length === 0 ? (
          <span className="note">Nothing published for this key yet.</span>
        ) : (
          records.map((r, i) => (
            <div key={i}>
              {r.ico} {r.text}
            </div>
          ))
        )}
      </div>
    </LuggageTag>
  );
}
