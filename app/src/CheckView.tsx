import { useEffect, useRef, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { normalize } from "viem/ens";
import { eq } from "@arkiv-network/sdk/query";
import { addr } from "@arkiv-network/sdk/schema";
import { Aboard, Exposure as ExposureSchema, NameCheck, checkExposure, helmCheck, type ChainExposure, type HelmReport } from "@lifeboat/core";
import { SEPOLIA_PQ_WALLETS, arkiv, mainnetClient, sepoliaAddr, sepoliaClient, sepoliaLogs, short } from "./lib";
import { Badge, HelmWheel, Ocean, STATUS_COLOR, Sonar, Stamp, Steps, type Blip, type SpokeState } from "./ui";

const EXAMPLES = [
  { tag: "ENS", label: "lifeboatpq.eth", value: "lifeboatpq.eth" },
  { tag: "EOA", label: "an exposed wallet", value: "0xBAc277e47dd7B95c04BB3517b76c1dd9151A054a" },
  { tag: "PQ", label: "a post-quantum wallet", value: "0x2e58B0f2336dFe76b8bbAb1BfD927E354CBC997F" },
];

const PATHS: Record<number, { title: string; why: string }> = {
  1: { title: "Owner", why: "holds the name's token in its parent registry" },
  2: { title: "Delegates", why: "other accounts with roles on the name, such as SET_RESOLVER" },
  3: { title: "Operators", why: "approved for all of the owner's names, so they can move this one" },
  4: { title: "Resolver role holders", why: "can rewrite the address and text records; UPGRADE can swap the resolver's code" },
  5: { title: "Parent registries", why: "admins of the registries above the name: systemic, outside the owner's control" },
};
const HELM_STEPS = ["Finding the registry that holds the name", "Rebuilding every role list from the logs (5 paths in parallel)", "Classifying every key and proving the lists complete"];

type Query = { kind: "name" | "address"; value: string };

export default function CheckView() {
  const [input, setInput] = useState("lifeboatpq.eth");
  const [query, setQuery] = useState<Query | null>(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [blips, setBlips] = useState<Blip[]>([]);
  const resultsRef = useRef<HTMLDivElement>(null);

  const submit = (raw: string) => {
    const v = raw.trim();
    setError("");
    let q: Query | null = null;
    if (isAddress(v, { strict: false })) q = { kind: "address", value: getAddress(v) };
    else if (/^[^\s]+\.[a-z]+$/i.test(v)) {
      try {
        q = { kind: "name", value: normalize(v) };
      } catch {
        setError("That doesn't look like a valid ENS name.");
      }
    } else setError("Enter an Ethereum address (0x…) or an ENSv2 name (name.eth).");
    if (q) {
      setQuery(q);
      setBlips([]);
      setScanning(true);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  };

  return (
    <>
      <section className="hero">
        <div className="stars" />
        <div className="wrap hero-inner">
          <div>
            <span className="eyebrow">Q-Day readiness scanner</span>
            <h1>
              Who could take over <em>this</em> on Q-Day?
            </h1>
            <p className="lede">
              A future quantum computer can take over any wallet whose public key is on-chain, and every signature puts it there. Paste an address, or an ENSv2 name to see every key that can steer it.
            </p>
            <form
              className="command"
              onSubmit={(e) => {
                e.preventDefault();
                submit(input);
              }}
            >
              <input aria-label="Address or ENS name" value={input} onChange={(e) => setInput(e.target.value)} placeholder="0x… or name.eth" spellCheck={false} autoComplete="off" />
              <button className="btn" type="submit" disabled={scanning}>
                {scanning ? "Scanning…" : "Scan"}
              </button>
            </form>
            <div className="chips">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.value}
                  className="chip"
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
              <p className="error-box" role="alert" style={{ maxWidth: 640 }}>
                {error}
              </p>
            )}
            <div className="disclaimer">🛈 No quantum computer can do this today. These are readiness findings from public on-chain data.</div>
          </div>
          <Sonar scanning={scanning} blips={blips} label={scanning ? "scanning…" : blips.length ? `${blips.length} keys found` : "standing by"} />
        </div>
        <Ocean />
      </section>

      <div className="wrap results" ref={resultsRef}>
        {query?.kind === "name" && <HelmPanel key={query.value} name={query.value} onDone={(b) => (setBlips(b), setScanning(false))} />}
        {query?.kind === "address" && <AddressPanel key={query.value} address={query.value as Address} onDone={(b) => (setBlips(b), setScanning(false))} />}
        {!query && <Intro />}
      </div>
    </>
  );
}

function Intro() {
  return (
    <div className="grid cols-4">
      {[
        ["Every signature leaks a key", "Not just sent transactions: multisig approvals, votes and signed orders publish public keys too."],
        ["Names get hijacked", "Five places control an ENSv2 name. Moving the name alone leaves the rest to the old key."],
        ["Escape with no ETH", "A staked paymaster on the EIP-8141 alt mempool pays the gas, and is repaid in tokens."],
        ["Proof, in public", "Every finding is re-checked on-chain and published to Arkiv, where anyone can verify it."],
      ].map(([t, d]) => (
        <div className="panel" key={t}>
          <h3>{t}</h3>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            {d}
          </p>
        </div>
      ))}
    </div>
  );
}

const blipColor = (e: string): Blip["color"] => (e === "exposed" ? "red" : e === "not-seen" ? "amber" : "green");

function spokeColor(report: HelmReport, path: number) {
  const es = report.entries.filter((e) => e.path === path);
  if (!es.length) return STATUS_COLOR.none!;
  for (const s of ["exposed", "not-seen", "contract", "pq-wallet"]) if (es.some((e) => e.holder.exposure === s)) return STATUS_COLOR[s]!;
  return STATUS_COLOR.none!;
}

function HelmPanel({ name, onDone }: { name: string; onDone: (b: Blip[]) => void }) {
  const [report, setReport] = useState<HelmReport | null>(null);
  const [err, setErr] = useState("");
  const [step, setStep] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [published, setPublished] = useState<{ verdict: string; block: string; key: string }[] | null>(null);
  const t0 = useRef(Date.now());
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    let live = true;
    helmCheck(sepoliaClient, sepoliaLogs, [mainnetClient], name, { pqWallets: SEPOLIA_PQ_WALLETS, onStep: (s) => live && setStep(Math.max(0, HELM_STEPS.indexOf(s))) })
      .then((r) => {
        if (!live) return;
        setReport(r);
        setSecs((Date.now() - t0.current) / 1000);
        onDone(r.entries.map((e) => ({ id: e.holder.address, color: blipColor(e.holder.exposure) })));
      })
      .catch((e) => {
        if (!live) return;
        setErr(String(e?.shortMessage ?? e?.message ?? e).slice(0, 240));
        onDone([]);
      });
    arkiv
      .select({ $key: true, verdict: true, checkedBlock: true })
      .from(NameCheck)
      .where(eq("name", name))
      .limit(5)
      .fetch()
      .then((res) => live && setPublished(res.entities.map((e) => ({ verdict: e.verdict.value, block: String(e.checkedBlock.value), key: e.$key }))))
      .catch(() => live && setPublished([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  if (err)
    return (
      <div className="panel">
        <p className="error-box">
          Couldn't check <b>{name}</b> on Sepolia ENSv2: {err}
        </p>
        <p className="note">Is it registered in ENSv2 on Sepolia? v1-only names aren't covered yet.</p>
      </div>
    );
  if (!report)
    return (
      <div className="panel scanning">
        <span className="spinner" />
        <div>
          <h3 style={{ margin: "0 0 8px" }}>Helm check: {name}</h3>
          <Steps steps={HELM_STEPS} current={step} />
        </div>
      </div>
    );

  const tone = report.verdict === "hijackable" ? "bad" : report.verdict === "protected" ? "good" : "unknown";
  const spokes: SpokeState[] = [1, 2, 3, 4, 5].map((p) => ({ path: p, label: PATHS[p]!.title, color: spokeColor(report, p) }));
  const keys = new Set(report.entries.map((e) => e.holder.address)).size;

  return (
    <div className="grid">
      <div className="panel stamp-row">
        <Stamp tone={tone}>{tone === "bad" ? "Hijackable on Q-Day" : tone === "good" ? "Protected" : "Unknown"}</Stamp>
        <div className="stamp-copy">
          {tone === "bad" ? (
            <>
              <b>{report.name}</b> can be steered through path{report.hijackablePaths.length > 1 ? "s" : ""} <b>{report.hijackablePaths.join(", ")}</b> by keys that are already public on-chain.
            </>
          ) : tone === "good" ? (
            <>
              No exposed key controls <b>{report.name}</b>. Its owner and every resolver role are held by a post-quantum wallet{report.systemicExposed ? " (parent-registry admins are systemic and shown below)" : ""}.
            </>
          ) : (
            <>The role list couldn't be proven complete, so we won't call it safe.</>
          )}
          <div className="note" style={{ marginTop: 6 }}>
            {keys} controlling keys · 5 paths · Sepolia block {report.block.toString()} · {secs.toFixed(1)} s
          </div>
        </div>
      </div>

      <div className="panel helm-layout">
        <HelmWheel spokes={spokes} active={active} onSelect={(p) => setActive(p === active ? null : p)} center={report.name} />
        <div>
          {[1, 2, 3, 4, 5].map((p) => {
            const es = report.entries.filter((e) => e.path === p);
            return (
              <div key={p} className={`path-card ${active === p ? "active" : ""}`} onMouseEnter={() => setActive(p)}>
                <div className="head">
                  <span className="n" style={{ background: spokeColor(report, p) }}>
                    {p}
                  </span>
                  <span className="t">{PATHS[p]!.title}</span>
                  <span className="note" style={{ marginLeft: "auto" }}>
                    {es.length ? `${es.length} key${es.length > 1 ? "s" : ""}` : "nobody"}
                  </span>
                </div>
                <div className="why">{PATHS[p]!.why}</div>
                {es.length === 0 && <div className="none">✓ no one holds this path</div>}
                {es.map((e, i) => (
                  <div className="holder" key={i}>
                    <Badge status={e.holder.exposure} />
                    <a className="addr" href={sepoliaAddr(e.holder.address)} target="_blank" rel="noreferrer">
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

      <div className="grid cols-2">
        <div className="panel">
          <h3>Is this list complete?</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
            ENSv2 stores only role <i>counts</i> on-chain. We rebuild every holder from the logs, then check that the sum of their role bitmaps equals the on-chain <span className="mono">roleCount</span>. One
            missing holder, and we say "unknown", never a false "safe".
          </p>
          {report.completeness.map((c, i) => (
            <div key={i} style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center" }}>
              <Badge status={c.complete ? "ok" : "exposed"}>{c.complete ? "proven complete" : "mismatch"}</Badge>
              <span className="mono muted">{c.where.replace(/0x[0-9a-fA-F]{40}/, (m) => short(m))}</span>
            </div>
          ))}
        </div>
        <div className="panel">
          <h3>Published to the Q-Day registry</h3>
          {published === null ? (
            <span className="spinner" />
          ) : published.length === 0 ? (
            <p className="note">No published verdict for this name yet.</p>
          ) : (
            published.map((p) => (
              <div key={p.key} style={{ marginTop: 6 }}>
                <Badge status={p.verdict === "protected" ? "pq" : "exposed"}>{p.verdict}</Badge> <span className="muted">at Sepolia block {p.block}</span>
                <div className="note mono">Arkiv entity {short(p.key, 8)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function AddressPanel({ address, onDone }: { address: Address; onDone: (b: Blip[]) => void }) {
  const [rows, setRows] = useState<ChainExposure[] | null>(null);
  const [records, setRecords] = useState<{ kind: string; text: string }[] | null>(null);

  useEffect(() => {
    let live = true;
    checkExposure(address).then((r) => {
      if (!live) return;
      setRows(r);
      onDone(r.filter((x) => x.status !== "error").map((x) => ({ id: `${address}${x.chain.id}`, color: x.status === "exposed" ? "red" : x.status === "not-seen" ? "amber" : "green" })));
    });
    Promise.all([
      arkiv.select({ $key: true, status: true, chainId: true, via: true }).from(ExposureSchema).where(eq("address", addr(address))).limit(10).fetch(),
      arkiv.select({ $key: true, from: true, to: true, kind: true }).from(Aboard).where(eq("from", addr(address))).limit(10).fetch(),
      arkiv.select({ $key: true, from: true, to: true, kind: true }).from(Aboard).where(eq("to", addr(address))).limit(10).fetch(),
    ])
      .then(([ex, outgoing, incoming]) => {
        if (!live) return;
        setRecords([
          ...ex.entities.map((e) => ({ kind: "📌", text: `${e.status.value} on chain ${e.chainId.value} (found via ${e.via.value})` })),
          ...outgoing.entities.map((e) => ({ kind: "🛟", text: `moved to post-quantum account ${short(e.to.value)} (${e.kind.value})` })),
          ...incoming.entities.map((e) => ({ kind: "🛟", text: `is a post-quantum account; received from ${short(e.from.value)} (${e.kind.value})` })),
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
      <div className="panel scanning">
        <span className="spinner" /> Checking {short(address)} on 6 chains…
      </div>
    );
  const exposed = rows.filter((r) => r.status === "exposed");
  const contract = rows.some((r) => r.status === "contract");
  const tone = exposed.length ? "bad" : contract ? "unknown" : "good";
  return (
    <div className="grid">
      <div className="panel stamp-row">
        <Stamp tone={tone}>{exposed.length ? "Key on-chain" : contract ? "Contract" : "Not seen"}</Stamp>
        <div className="stamp-copy">
          {exposed.length ? (
            <>
              <b className="mono">{short(address)}</b> has signed transactions on <b>{exposed.map((r) => r.chain.name).join(", ")}</b>. Its public key is recoverable from any of them, so a quantum computer could derive the
              private key.
            </>
          ) : contract ? (
            <>This is a contract: who controls it depends on its owners and admins. A deep scan follows those keys.</>
          ) : (
            <>No transactions from this address on these chains. Signatures elsewhere (multisig approvals, votes, orders) can still reveal its key: that's the deep scan.</>
          )}
        </div>
      </div>
      <div className="panel">
        <h3>Chain by chain</h3>
        <div className="buoys">
          {rows.map((r) => (
            <div key={r.chain.id} className={`buoy ${r.status}`}>
              <div className="cn">{r.chain.name}</div>
              <div className="cs">{r.status === "exposed" ? "key on-chain" : r.status === "not-seen" ? "not seen" : r.status}</div>
              <div className="cd">
                {r.status === "error" ? "unreachable" : `${r.nonce} txs · ${Number(r.balance).toFixed(4)} ${r.chain.symbol}`}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <h3>In the public Q-Day registry</h3>
        {records === null ? (
          <span className="spinner" />
        ) : records.length === 0 ? (
          <p className="note">Nothing published for this address yet.</p>
        ) : (
          records.map((r, i) => (
            <div key={i} className="aboard-item">
              <span className="ico">{r.kind}</span>
              <span>{r.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
