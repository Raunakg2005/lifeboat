import { useEffect, useState } from "react";
import { getAddress, isAddress, parseAbi, type Address } from "viem";
import { normalize } from "viem/ens";
import { desc, eq } from "@arkiv-network/sdk/query";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import { Aboard, COUNCILS, Exposure as ExposureSchema, NameCheck, PUBLISHER, checkExposure, helmCheck, registeredNames, scanSafe, type ChainExposure, type HelmReport } from "@lifeboat/core";
import { OUR_TEST_ACCOUNTS, SEPOLIA_PQ_WALLETS, walletProvider, arkiv, arkivErrorText, chainName, expiresIn, mainnetClient, newestPer, safeClient, safeLogs, sepoliaAddr, sepoliaClient, sepoliaLogs, short, swarmUrl, exposureEvidence, type EvidenceRecord, type Flags } from "./lib";
import EvidenceDrawer, { ArkivLink, EvidenceButton, FlagStamp, TestTag } from "./EvidenceDrawer";
import { SafeProof, SafeTag, type SafeRow } from "./SafeTag";
import survey from "../../evidence/ens/survey.json";
import { HelmWheel, LuggageTag, Pill, Radar, Rubber, STATUS_FILL, Steps, type SpokeState } from "./ui";


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
  const [mode, setMode] = useState<"address" | "name" | "safe">("name");
  const [input, setInput] = useState("");
  const [picking, setPicking] = useState<"" | "name" | "wallet">("");
  const hasWallet = typeof window !== "undefined" && !!walletProvider();
  const [query, setQuery] = useState<Query | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = (raw: string, hint?: "safe") => {
    const v = raw.trim();
    setError("");
    if (isAddress(v, { strict: false })) {
      setMode(hint === "safe" || mode === "safe" ? "safe" : "address");
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

  // Switching mode clears an input of the wrong kind (an address in name mode, a name in address/Safe mode).
  const switchMode = (m: "address" | "name" | "safe") => {
    setMode(m);
    const v = input.trim();
    if (v && (m === "name" ? isAddress(v, { strict: false }) : !isAddress(v, { strict: false }))) setInput("");
  };
  // A real name someone registered in ENSv2 recently (never one of ours), picked at random.
  const pickName = async () => {
    setPicking("name");
    setError("");
    try {
      const names = await registeredNames(sepoliaClient, sepoliaLogs, { exclude: [PUBLISHER, ...OUR_TEST_ACCOUNTS], lastBlocks: 100_000n });
      if (!names.length) throw new Error("no names registered in the last ~2 weeks");
      // one name per owner (their newest), so a bulk registrant doesn't dominate the pick
      const byOwner = new Map<string, string>();
      for (const n of names) if (!byOwner.has(n.owner)) byOwner.set(n.owner, n.name);
      const pool = [...byOwner.values()];
      const pick = pool[Math.floor(Math.random() * pool.length)]!;
      setInput(pick);
      submit(pick);
    } catch (e) {
      setError(`Couldn't list recent ENSv2 names: ${String((e as Error).message).slice(0, 160)}`);
    } finally {
      setPicking("");
    }
  };
  const pickCouncil = () => {
    const c = COUNCILS[Math.floor(Math.random() * COUNCILS.length)]!;
    setInput(c.safe);
    submit(c.safe, "safe");
  };
  // Read-only: asks the wallet for its address, never for a signature.
  const useMyWallet = async () => {
    setPicking("wallet");
    setError("");
    try {
      const eth = walletProvider<{ request: (a: { method: string }) => Promise<string[]> }>()!;
      const [a] = await eth.request({ method: "eth_requestAccounts" });
      if (a) {
        setInput(a);
        submit(a);
      }
    } catch (e) {
      setError(`Your wallet didn't share an address: ${String((e as Error).message).slice(0, 120)}`);
    } finally {
      setPicking("");
    }
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
            A future quantum computer can take over any wallet whose public key is on-chain, and every signature puts it there. Check who could take over your wallet, your Safe or your name, then get off
            before Q-Day.
          </p>
          <div className="toggle" role="group" aria-label="What to check">
            <button aria-pressed={mode === "name"} onClick={() => switchMode("name")}>
              ENS name
            </button>
            <button aria-pressed={mode === "address"} onClick={() => switchMode("address")}>
              Address
            </button>
            <button aria-pressed={mode === "safe"} onClick={() => switchMode("safe")}>
              Safe
            </button>
          </div>
          <form
            className="passenger"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <span className="tag">{mode === "name" ? "Vessel" : mode === "safe" ? "Treasury" : "Passenger"}</span>
            <input aria-label="Address or ENS name" value={input} onChange={(e) => setInput(e.target.value)} placeholder={mode === "name" ? "name.eth" : mode === "safe" ? "0x… a Safe on Ethereum mainnet" : "0x…"} spellCheck={false} autoComplete="off" />
            <button type="submit" disabled={busy}>
              {busy ? "Scanning" : mode === "name" ? "Helm check" : mode === "safe" ? "Deep scan" : "Check manifest"}
            </button>
          </form>
          <div className="hint">
            {mode === "name"
              ? "Any ENSv2 name on Sepolia: every key that can steer it, across all five control paths."
              : mode === "safe"
                ? "Any Safe on Ethereum mainnet: every signer's public key, recovered from the Safe's own signatures. Runs in your browser; nothing is published."
                : "Checks Ethereum, Base, Arbitrum, Optimism, Polygon, Sepolia. Read-only: Lifeboat never asks for a key or a signature."}
          </div>
          <div className="examples">
            <span className="label" style={{ alignSelf: "center" }}>
              Try
            </span>
            <button type="button" disabled={!!picking || busy} onClick={pickName}>
              <b>name</b> {picking === "name" ? "picking a name…" : "a random real ENSv2 name"}
            </button>
            <button type="button" disabled={!!picking || busy} onClick={pickCouncil}>
              <b>safe</b> a security council
            </button>
            {hasWallet && (
              <button type="button" disabled={!!picking || busy} onClick={useMyWallet}>
                <b>wallet</b> {picking === "wallet" ? "asking your wallet…" : "my connected wallet"}
              </button>
            )}
          </div>
          {error && (
            <p className="error-box" role="alert" style={{ maxWidth: 680 }}>
              {error}
            </p>
          )}
          {mode === "name" && (
            <div className="survey-line">
              Across real ENSv2 names (one per owner, Sepolia block {Number(survey.block).toLocaleString("en-US")}): <b>{survey.verdicts.hijackable.toLocaleString("en-US")}</b> of {survey.checked.toLocaleString("en-US")} can be steered on Q-Day,{" "}
              <b>{survey.resolverExposed.toLocaleString("en-US")}</b> of them through their resolver. Names are counted, never listed.
            </div>
          )}
          <div className="warning">No quantum computer can do this today. These are readiness findings from public on-chain data.</div>
        </div>
        <RegistryBoard onGo={onGo} />
      </section>

      <div className="section">
        {query?.kind === "name" && <HelmPanel key={query.value} name={query.value} onDone={() => setBusy(false)} />}
        {query?.kind === "address" && <AddressOrSafe key={query.value} address={query.value as Address} onDone={() => setBusy(false)} />}
      </div>
    </>
  );
}

/** Right-hand board: live counts from the public Q-Day registry on Arkiv. */
type Board = {
  exposed: string;
  exposedRecords: bigint;
  aboard: bigint;
  names: string;
  nameRecords: bigint;
  newest: { key: string; a: string; kind: string; expiresAt: bigint }[];
  block: bigint;
};

function RegistryBoard({ onGo }: { onGo: (t: Tab) => void }) {
  const [d, setD] = useState<Board | null>(null);
  const [failed, setFailed] = useState("");
  const [attempt, setAttempt] = useState(0); // "try again" reads Arkiv again, without a page reload
  useEffect(() => {
    let live = true;
    setFailed("");
    Promise.all([
      arkiv.select({ $key: true, $createdAt: true, address: true, chainId: true }).from(ExposureSchema).withCount().where(eq("status", "exposed")).ownedBy(PUBLISHER).orderBy(desc("$expiresAt")).limit(100).fetch(),
      arkiv.select({ $key: true, $expiresAt: true, from: true, kind: true }).from(Aboard).withCount().ownedBy(PUBLISHER).orderBy(desc("$expiresAt")).limit(3).fetch(),
      arkiv.select({ $key: true, $createdAt: true, name: true, chainId: true }).from(NameCheck).withCount().ownedBy(PUBLISHER).orderBy(desc("$expiresAt")).limit(100).fetch(),
    ])
      .then(([e, a, n]) => {
        if (!live) return;
        // Re-checks write new entities: count each key and each name once (its newest reading).
        const keys = newestPer(e.entities.map((x) => ({ createdAt: x.$createdAt, id: `${x.address.value.toLowerCase()}:${x.chainId.value}` })), (x) => x.id).length;
        const names = newestPer(n.entities.map((x) => ({ createdAt: x.$createdAt, id: `${x.name.value}:${x.chainId.value}` })), (x) => x.id).length;
        setD({
          exposed: `${keys}${BigInt(e.entities.length + e.skipped) < e.count ? "+" : ""}`,
          exposedRecords: e.count,
          aboard: a.count,
          names: `${names}${BigInt(n.entities.length + n.skipped) < n.count ? "+" : ""}`,
          nameRecords: n.count,
          newest: a.entities.map((x) => ({ key: x.$key, a: x.from.value, kind: x.kind.value, expiresAt: x.$expiresAt })),
          block: a.blockNumber,
        });
      })
      .catch((e) => live && setFailed(arkivErrorText(e)));
    return () => {
      live = false;
    };
  }, [attempt]);
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
          <div className="v">{d ? d.exposed : failed ? "–" : "…"}</div>
          {d && <div className="sub">keys · {String(d.exposedRecords)} readings</div>}
        </div>
        <div>
          <div className="label">Aboard</div>
          <div className="v green">{d ? String(d.aboard) : failed ? "–" : "…"}</div>
          {d && <div className="sub">moves</div>}
        </div>
        <div>
          <div className="label">Names</div>
          <div className="v ink">{d ? d.names : failed ? "–" : "…"}</div>
          {d && <div className="sub">names · {String(d.nameRecords)} readings</div>}
        </div>
      </div>
      {failed && (
        <div className="board-row note">
          Arkiv didn't answer: {failed}{" "}
          <button className="link-btn" onClick={() => setAttempt((x) => x + 1)}>
            try again
          </button>
        </div>
      )}
      {d && d.newest.length > 0 && (
        <div className="board-row label" style={{ paddingBottom: 0, borderBottom: 0 }}>
          Newest aboard
        </div>
      )}
      {d?.newest.map((n) => (
        <div className="board-row" key={n.key} style={{ flexWrap: "wrap" }}>
          <span className="sq" style={{ background: "#1d8a5b" }} />
          <span className="mono">{short(n.a)}</span>
          <TestTag account={n.a} />
          <span className="note" style={{ marginLeft: "auto" }}>
            {n.kind === "rescue-sweep" ? "rescued" : n.kind === "ens-handover" ? "name handed over" : n.kind}
          </span>
          <span className="rec-meta" style={{ flexBasis: "100%", paddingLeft: 24 }}>
            <span>{expiresIn(n.expiresAt, d.block)}</span>
            <ArkivLink entityKey={n.key} />
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
  const [published, setPublished] = useState<{ verdict: string; block: string; key: string; expiresAt: bigint; ev?: EvidenceRecord }[] | null>(null);
  const [arkivBlock, setArkivBlock] = useState(0n);
  const [ev, setEv] = useState<EvidenceRecord | null>(null);
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    let live = true;
    const t0 = Date.now();
    helmCheck(sepoliaClient, sepoliaLogs, [mainnetClient], name, { pqWallets: SEPOLIA_PQ_WALLETS, onStep: (s) => live && setStep(Math.max(0, HELM_STEPS.indexOf(s))) })
      .then((r) => live && (setReport(r), setSecs((Date.now() - t0) / 1000)))
      .catch((e) => live && setErr(String(e?.shortMessage ?? e?.message ?? e).slice(0, 240)))
      .finally(() => live && onDone());
    // Only the Lifeboat publisher's verdicts count: anyone can write a lifeboat.name.v1 entity.
    arkiv
      .select({ $key: true, $expiresAt: true, verdict: true, checkedBlock: true, swarmRef: true, evidenceHash: true })
      .from(NameCheck)
      .where(eq("name", name), eq("chainId", u64(11155111n)))
      .ownedBy(PUBLISHER)
      .orderBy(desc("$expiresAt"))
      .limit(5)
      .fetch()
      .then((res) => {
        if (!live) return;
        setArkivBlock(res.blockNumber);
        setPublished(
          res.entities.map((e) => ({
            verdict: e.verdict.value,
            block: String(e.checkedBlock.value),
            key: e.$key,
            expiresAt: e.$expiresAt,
            ev: e.swarmRef ? { key: e.$key, kind: "name" as const, swarmRef: e.swarmRef.value, evidenceHash: e.evidenceHash?.value, name, verdict: e.verdict.value, block: String(e.checkedBlock.value) } : undefined,
          })),
        );
      })
      .catch(() => live && setPublished([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  if (err)
    return (
      <div className="error-box">
        Couldn't finish the Helm check for <b>{name}</b>: {err}.{" "}
        {/limit|rate|429|timeout|timed out/i.test(err) ? "The public RPC is busy: try again in a moment." : "Is it registered in ENSv2 on Sepolia? Names that exist only in ENS v1 (mainnet) aren't covered yet."}
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

  // "protected" from the check means no exposed key on paths 1-4. Say exactly why, so a contract owner or a key
  // that simply hasn't signed yet is never presented as post-quantum.
  const pathHolders = report.entries.filter((e) => e.path <= 4);
  const ownerKind = report.entries.find((e) => e.path === 1)?.holder.exposure;
  const allPq = pathHolders.length > 0 && pathHolders.every((e) => e.holder.exposure === "pq-wallet");
  const state: "bad" | "pq" | "contract" | "not-seen" | "unknown" =
    report.verdict === "hijackable" ? "bad" : report.verdict === "unknown" ? "unknown" : allPq ? "pq" : ownerKind === "contract" || pathHolders.some((e) => e.holder.exposure === "contract") ? "contract" : "not-seen";
  const tone = state === "bad" ? "bad" : state === "pq" ? "good" : "unknown";
  const spokes: SpokeState[] = [1, 2, 3, 4, 5].map((p) => ({ path: p, label: PATHS[p]!.title, fill: spokeFill(report, p) }));
  const keys = new Set(report.entries.map((e) => e.holder.address)).size;

  return (
    <div className="grid">
      <LuggageTag
        tone={tone}
        verdict={state === "bad" ? "Hijackable" : state === "pq" ? "Protected" : state === "contract" ? "Contract" : state === "not-seen" ? "Not seen" : "Unknown"}
        id={report.name}
        meta={`${keys} keys at the helm · Sepolia block ${report.block.toString()} · ${secs.toFixed(1)} s`}
      >
        <p className="desc">
          {tone === "bad" ? (
            <>
              On Q-Day this name can be steered through path{report.hijackablePaths.length > 1 ? "s" : ""} <b>{report.hijackablePaths.join(", ")}</b> by keys whose public keys are already on-chain.
            </>
          ) : state === "pq" ? (
            <>No exposed key steers this name. Its owner and every resolver role sit with a post-quantum wallet{report.systemicExposed ? "; the port authority (path 5) is systemic and shown for the record" : ""}.</>
          ) : state === "contract" ? (
            <>No key on paths 1-4 has its public key on-chain, but a contract holds the name: who controls it depends on that contract's own signers (deep-scan it if it's a Safe).</>
          ) : state === "not-seen" ? (
            <>No key on paths 1-4 has revealed its public key yet. The first transaction or signature from one of them will: move the name to a post-quantum wallet before that.</>
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
              <Rubber good={c.complete}>{c.complete ? "Proven complete" : "Not proven"}</Rubber>
              <span className="mono muted">
                {c.where.replace(/0x[0-9a-fA-F]{40}/, (m) => short(m))}
                {c.note ? ` · ${c.note}` : ""}
              </span>
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
            published.map((p, i) => (
              <div key={p.key} style={{ marginTop: 8 }}>
                <Pill status={p.verdict === "protected" ? "pq" : p.verdict === "unknown" ? "not-seen" : "exposed"}>{p.verdict}</Pill>{" "}
                <span className="muted">at Sepolia block {Number(p.block).toLocaleString("en-US")}</span> {i === 0 && <span className="test-tag latest">latest</span>}
                <div className="rec-meta" style={{ marginTop: 2 }}>
                  <span>{expiresIn(p.expiresAt, arkivBlock)}</span>
                  <ArkivLink entityKey={p.key} />
                  {p.ev && (
                    <>
                      <a className="arkiv-link" href={swarmUrl(p.ev.swarmRef)} target="_blank" rel="noreferrer">
                        Swarm ↗
                      </a>
                      <EvidenceButton onOpen={() => setEv(p.ev!)} />
                    </>
                  )}
                </div>
              </div>
            ))
          )}
          {published && published.length > 0 && (
            <p className="note" style={{ marginBottom: 0 }}>
              Signed by the Lifeboat publisher, newest first.
            </p>
          )}
        </div>
      </div>
      {ev && <EvidenceDrawer swarmRef={ev.swarmRef} records={[ev]} title={`Helm check · ${name}`} onClose={() => setEv(null)} />}
    </div>
  );
}

function AddressPanel({ address, onDone }: { address: Address; onDone: () => void }) {
  const [rows, setRows] = useState<ChainExposure[] | null>(null);
  const [records, setRecords] = useState<{ key: string; ico: string; text: string; expiresAt: bigint; flags?: Flags; ev?: EvidenceRecord }[] | null>(null);
  const [arkivBlock, setArkivBlock] = useState(0n);
  const [ev, setEv] = useState<EvidenceRecord | null>(null);

  useEffect(() => {
    let live = true;
    checkExposure(address)
      .then((r) => live && setRows(r))
      .finally(() => live && onDone());
    // Only the Lifeboat publisher's records are shown as fact: anyone can write an entity with these schemas.
    const aboard = (side: "from" | "to") =>
      arkiv
        .select({ $key: true, $expiresAt: true, $creationFlags: true, from: true, to: true, kind: true, txHash: true, swarmRef: true, evidenceHash: true })
        .from(Aboard)
        .where(eq(side, addr(address)))
        .ownedBy(PUBLISHER)
        .orderBy(desc("$expiresAt"))
        .limit(10)
        .fetch();
    Promise.all([
      arkiv
        .select({ $key: true, $createdAt: true, $expiresAt: true, address: true, status: true, chainId: true, via: true, checkedBlock: true, swarmRef: true, evidenceHash: true })
        .from(ExposureSchema)
        .where(eq("address", addr(address)))
        .ownedBy(PUBLISHER)
        .orderBy(desc("$expiresAt"))
        .limit(30)
        .fetch(),
      aboard("from"),
      aboard("to"),
    ])
      .then(([ex, outgoing, incoming]) => {
        if (!live) return;
        setArkivBlock(ex.blockNumber);
        // Re-checks write new entities: the newest reading per network.
        const readings = newestPer(
          ex.entities.map((e) => ({ createdAt: e.$createdAt, e })),
          (x) => String(x.e.chainId.value),
        );
        const aboardEv = (e: (typeof outgoing.entities)[number]): EvidenceRecord | undefined =>
          e.swarmRef ? { key: e.$key, kind: "aboard", swarmRef: e.swarmRef.value, evidenceHash: e.evidenceHash?.value, txHash: e.txHash.value } : undefined;
        setRecords([
          ...readings.map(({ e }) => ({
            key: e.$key,
            ico: "📌",
            text: `${e.status.value} on ${chainName(String(e.chainId.value))} (found via ${e.via.value}, block ${Number(e.checkedBlock.value).toLocaleString("en-US")})`,
            expiresAt: e.$expiresAt,
            ev: e.swarmRef ? exposureEvidence(e.$key, e) : undefined,
          })),
          ...outgoing.entities.map((e) => ({ key: e.$key, ico: "🛟", text: `moved to post-quantum account ${short(e.to.value)} (${e.kind.value})`, expiresAt: e.$expiresAt, flags: e.$creationFlags, ev: aboardEv(e) })),
          ...incoming.entities.map((e) => ({ key: e.$key, ico: "🛟", text: `is a post-quantum account; received from ${short(e.from.value)} (${e.kind.value})`, expiresAt: e.$expiresAt, flags: e.$creationFlags, ev: aboardEv(e) })),
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
          records.map((r) => (
            <div key={r.key} style={{ marginTop: 4 }}>
              {r.ico} {r.text}
              <div className="rec-meta" style={{ paddingLeft: 24 }}>
                {r.flags && <FlagStamp flags={r.flags} />}
                <span>{expiresIn(r.expiresAt, arkivBlock)}</span>
                <ArkivLink entityKey={r.key} />
                {r.ev && (
                  <>
                    <a className="arkiv-link" href={swarmUrl(r.ev.swarmRef)} target="_blank" rel="noreferrer">
                      Swarm ↗
                    </a>
                    <EvidenceButton onOpen={() => setEv(r.ev!)} />
                  </>
                )}
              </div>
            </div>
          ))
        )}
        {records && records.length > 0 && <div className="note">Signed by the Lifeboat publisher · newest reading per network.</div>}
      </div>
      {ev && <EvidenceDrawer swarmRef={ev.swarmRef} records={[ev]} title={`Public registry · ${short(address)}`} onClose={() => setEv(null)} />}
    </LuggageTag>
  );
}

const SAFE_PROBE = parseAbi(["function getThreshold() view returns (uint256)", "function getOwners() view returns (address[])"]);

/** An address on Ethereum mainnet that answers getThreshold/getOwners is a Safe: deep scan it. Anything else: the exposure check. */
function AddressOrSafe({ address, onDone }: { address: Address; onDone: () => void }) {
  const [kind, setKind] = useState<"probing" | "safe" | "address">("probing");
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const code = await mainnetClient.getCode({ address });
        if (code && code !== "0x") {
          await Promise.all([
            mainnetClient.readContract({ address, abi: SAFE_PROBE, functionName: "getThreshold" }),
            mainnetClient.readContract({ address, abi: SAFE_PROBE, functionName: "getOwners" }),
          ]);
          if (live) setKind("safe");
          return;
        }
      } catch {
        // not a Safe (or not on mainnet): fall through to the exposure check
      }
      if (live) setKind("address");
    })();
    return () => {
      live = false;
    };
  }, [address]);
  if (kind === "probing")
    return (
      <div className="board loading">
        <Radar />
        <div>
          <div className="stencil" style={{ fontSize: 30 }}>
            Boarding {short(address)}
          </div>
          <div className="note">is it a wallet or a Safe?</div>
        </div>
      </div>
    );
  return kind === "safe" ? <SafePanel address={address} onDone={onDone} /> : <AddressPanel address={address} onDone={onDone} />;
}

/** Deep scan of one Safe, live in the browser: owners, nonces, then every signer recovered from the Safe's executions. */
function SafePanel({ address, onDone }: { address: Address; onDone: () => void }) {
  const [res, setRes] = useState<SafeRow | null>(null);
  const [steps, setSteps] = useState<string[]>(["Reading owners and threshold"]);
  const [err, setErr] = useState("");
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    let live = true;
    const t0 = Date.now();
    const known = COUNCILS.find((c) => c.safe.toLowerCase() === address.toLowerCase());
    scanSafe(safeClient, safeLogs, address, { label: known?.label ?? `Safe ${short(address)}`, maxExecutions: 80, onStep: (s) => live && setSteps((x) => [...x, s]) })
      .then((r) => live && (setRes(r as unknown as SafeRow), setSecs((Date.now() - t0) / 1000)))
      .catch((e) => live && setErr(String(e?.shortMessage ?? e?.message ?? e).slice(0, 240)))
      .finally(() => live && onDone());
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  if (err) return <div className="error-box">Couldn't scan this Safe on Ethereum mainnet: {err}</div>;
  if (!res)
    return (
      <div className="board loading">
        <Radar />
        <div>
          <div className="stencil" style={{ fontSize: 30 }}>
            Deep scan: Safe {short(address)}
          </div>
          <Steps steps={steps} current={steps.length - 1} />
        </div>
      </div>
    );

  const n = res.owners.length;
  const hiddenFlip = res.takeableWithSignatures && !res.takeableByNonce;
  return (
    <div className="grid">
      <div className={`seal ${res.takeableWithSignatures ? "bad" : "good"}`}>
        <Rubber good={!res.takeableWithSignatures}>{res.takeableWithSignatures ? (hiddenFlip ? "Hidden" : "Exposed") : "Holds"}</Rubber>
        <div>
          <div className="big">
            {res.exposedTotal} of {n} signer keys are public · threshold {res.threshold}
          </div>
          <div className="muted">
            {res.takeableWithSignatures
              ? hiddenFlip
                ? `A nonce check sees ${res.exposedByNonce}. Counting signatures, enough keys are public to reach the threshold: on Q-Day, this Safe's upgrade path is open.`
                : `Enough keys are public to reach the threshold: on Q-Day, this Safe's upgrade path is open.`
              : `Fewer public keys than the threshold today. Every new signature can change that, so watch it.`}{" "}
            No quantum computer can do this today: this is readiness data.
          </div>
        </div>
      </div>
      <SafeTag r={res} />
      <SafeProof rows={[res]} />
      <div className="grid cols-2">
        <div className="paper-card">
          <h3>What helps</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Swapping signers buys little: each new signer's first signature reveals its key.</li>
            <li>A post-quantum co-signer on the Safe protects it without moving funds (Lifeboat's Quantum Guard, in development).</li>
            <li>For a protocol: a readiness assessment maps every admin key and ranks the migration steps.</li>
          </ul>
        </div>
        <div className="paper-card">
          <h3>How this was checked</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            In your browser, at Ethereum block {String(res.block)}, in {secs.toFixed(1)} s: owner nonces on 5 chains, then the signer of every signature in the latest {res.executionsDecoded} decoded executions (of{" "}
            {res.executionsSeen}). Executions routed through other contracts are skipped, so this is a lower bound. Nothing was published.
          </p>
        </div>
      </div>
    </div>
  );
}
