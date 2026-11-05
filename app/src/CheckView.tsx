import { useEffect, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { normalize } from "viem/ens";
import { eq } from "@arkiv-network/sdk/query";
import { addr } from "@arkiv-network/sdk/schema";
import { Aboard, Exposure as ExposureSchema, NameCheck, checkExposure, helmCheck, type ChainExposure, type HelmReport } from "@lifeboat/core";
import { SEPOLIA_PQ_WALLETS, arkiv, mainnetClient, sepoliaAddr, sepoliaClient, sepoliaLogs, short } from "./lib";

const EXAMPLES = [
  { label: "lifeboatpq.eth (after handover)", value: "lifeboatpq.eth" },
  { label: "an exposed wallet", value: "0xBAc277e47dd7B95c04BB3517b76c1dd9151A054a" },
  { label: "a post-quantum wallet", value: "0x2e58B0f2336dFe76b8bbAb1BfD927E354CBC997F" },
];

const PATHS: Record<number, { title: string; why: string }> = {
  1: { title: "Owner", why: "holds the name's token in its parent registry" },
  2: { title: "Delegates", why: "other accounts with roles on the name, such as SET_RESOLVER" },
  3: { title: "Operators", why: "approved for all of the owner's names: they can move this one" },
  4: { title: "Resolver role holders", why: "can rewrite the address and text records; UPGRADE can replace the resolver's code" },
  5: { title: "Parent registries", why: "admins of the registries above the name (systemic, outside the owner's control)" },
};

const statusLabel: Record<string, string> = { exposed: "public key on-chain", "not-seen": "not seen", "pq-wallet": "post-quantum", pq: "post-quantum", contract: "contract", error: "unreachable" };

function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      <span className="dot" />
      {statusLabel[status] ?? status}
    </span>
  );
}

export default function CheckView() {
  const [input, setInput] = useState("lifeboatpq.eth");
  const [query, setQuery] = useState<{ kind: "name" | "address"; value: string } | null>(null);
  const [error, setError] = useState("");

  const submit = (raw: string) => {
    const v = raw.trim();
    setError("");
    if (isAddress(v, { strict: false })) setQuery({ kind: "address", value: getAddress(v) });
    else if (/^[^\s]+\.[a-z]+$/i.test(v)) {
      try {
        setQuery({ kind: "name", value: normalize(v) });
      } catch {
        setError("That doesn't look like a valid ENS name.");
      }
    } else setError("Enter an Ethereum address (0x…) or an ENS name (name.eth).");
  };

  return (
    <section>
      <h2>Who could take over this?</h2>
      <p className="sub">Paste an address to see if its public key is already on-chain, or an ENSv2 name (Sepolia) to see every key that can steer it.</p>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <input aria-label="Address or ENS name" value={input} onChange={(e) => setInput(e.target.value)} placeholder="0x… or name.eth" spellCheck={false} />
        <button className="primary" type="submit">
          Check
        </button>
      </form>
      <div className="examples">
        Try:
        {EXAMPLES.map((ex) => (
          <button
            key={ex.value}
            className="link"
            type="button"
            onClick={() => {
              setInput(ex.value);
              submit(ex.value);
            }}
          >
            {ex.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
      {query?.kind === "name" && <HelmPanel key={query.value} name={query.value} />}
      {query?.kind === "address" && <AddressPanel key={query.value} address={query.value as Address} />}
    </section>
  );
}

function HelmPanel({ name }: { name: string }) {
  const [report, setReport] = useState<HelmReport | null>(null);
  const [err, setErr] = useState("");
  const [published, setPublished] = useState<{ verdict: string; block: string; key: string }[] | null>(null);

  useEffect(() => {
    let live = true;
    helmCheck(sepoliaClient, sepoliaLogs, [mainnetClient], name, { pqWallets: SEPOLIA_PQ_WALLETS })
      .then((r) => live && setReport(r))
      .catch((e) => live && setErr(String(e?.shortMessage ?? e?.message ?? e).slice(0, 240)));
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
  }, [name]);

  if (err)
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <p className="error-box">
          Couldn't check <b>{name}</b> on Sepolia ENSv2: {err}
        </p>
        <p className="note">Is it registered in ENSv2 on Sepolia? v1-only names aren't covered yet.</p>
      </div>
    );
  if (!report)
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <span className="spinner" /> Checking <b>{name}</b>: reading the registry, rebuilding every role list from logs, proving it complete…
      </div>
    );

  const cls = report.verdict === "hijackable" ? "bad" : report.verdict === "protected" ? "good" : "unknown";
  return (
    <div className="grid" style={{ marginTop: 16 }}>
      <div className={`verdict ${cls}`}>
        <span className="big">{report.verdict === "hijackable" ? "Hijackable on Q-Day" : report.verdict === "protected" ? "Protected" : "Unknown"}</span>
        <span className="detail">
          {report.verdict === "hijackable"
            ? `through path${report.hijackablePaths.length > 1 ? "s" : ""} ${report.hijackablePaths.join(", ")}: these keys are already public on-chain`
            : report.verdict === "protected"
              ? "no exposed key controls this name (parent registries aside)"
              : "the role list could not be proven complete"}
        </span>
      </div>
      <div className="card">
        <h3>
          Helm check: {report.name} <span className="note">· Sepolia block {report.block.toString()}</span>
        </h3>
        {[1, 2, 3, 4, 5].map((p) => {
          const es = report.entries.filter((e) => e.path === p);
          return (
            <div className="path" key={p}>
              <div className="path-head">
                <div>
                  <span className="n">{p}</span>
                  <b>{PATHS[p]!.title}</b> <span className="note">: {PATHS[p]!.why}</span>
                </div>
              </div>
              {es.length === 0 && <div className="none">none</div>}
              {es.map((e, i) => (
                <div className="holder" key={i}>
                  <Badge status={e.holder.exposure} />
                  <a className="addr" href={sepoliaAddr(e.holder.address)} target="_blank" rel="noreferrer">
                    {e.holder.address}
                  </a>
                  <div className="roles">
                    {e.power.join(", ")} · {e.holder.detail}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="card">
        <h3>Is this list complete?</h3>
        <p className="note">ENSv2 stores only role counts on-chain. We rebuild the holders from logs, then check that the sum of their role bitmaps equals the on-chain roleCount.</p>
        {report.completeness.map((c, i) => (
          <div key={i} style={{ marginTop: 6 }}>
            <span className={`badge ${c.complete ? "ok" : "exposed"}`}>{c.complete ? "proven complete" : "mismatch"}</span>{" "}
            <span className="mono">{c.where.replace(/0x[0-9a-fA-F]{40}/, (m) => short(m))}</span>
          </div>
        ))}
      </div>
      <div className="card">
        <h3>Published on Arkiv</h3>
        {published === null ? (
          <span className="spinner" />
        ) : published.length === 0 ? (
          <p className="note">No published verdict for this name yet.</p>
        ) : (
          published.map((p) => (
            <div key={p.key}>
              <Badge status={p.verdict === "protected" ? "pq" : "exposed"} /> {p.verdict} at Sepolia block {p.block} <span className="note mono">entity {short(p.key)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AddressPanel({ address }: { address: Address }) {
  const [rows, setRows] = useState<ChainExposure[] | null>(null);
  const [records, setRecords] = useState<{ kind: string; text: string }[] | null>(null);

  useEffect(() => {
    let live = true;
    checkExposure(address).then((r) => live && setRows(r));
    Promise.all([
      arkiv.select({ $key: true, status: true, chainId: true, via: true }).from(ExposureSchema).where(eq("address", addr(address))).limit(10).fetch(),
      arkiv.select({ $key: true, from: true, to: true, kind: true }).from(Aboard).where(eq("from", addr(address))).limit(10).fetch(),
      arkiv.select({ $key: true, from: true, to: true, kind: true }).from(Aboard).where(eq("to", addr(address))).limit(10).fetch(),
    ])
      .then(([ex, outgoing, incoming]) => {
        if (!live) return;
        setRecords([
          ...ex.entities.map((e) => ({ kind: "attestation", text: `${e.status.value} on chain ${e.chainId.value} (via ${e.via.value})` })),
          ...outgoing.entities.map((e) => ({ kind: "aboard", text: `moved to post-quantum account ${short(e.to.value)} (${e.kind.value})` })),
          ...incoming.entities.map((e) => ({ kind: "aboard", text: `post-quantum account; received from ${short(e.from.value)} (${e.kind.value})` })),
        ]);
      })
      .catch(() => live && setRecords([]));
    return () => {
      live = false;
    };
  }, [address]);

  const exposed = rows?.filter((r) => r.status === "exposed") ?? [];
  return (
    <div className="grid" style={{ marginTop: 16 }}>
      {rows && (
        <div className={`verdict ${exposed.length ? "bad" : rows.some((r) => r.status === "contract") ? "unknown" : "good"}`}>
          <span className="big">{exposed.length ? "Public key is on-chain" : rows.some((r) => r.status === "contract") ? "Contract" : "Not seen signing"}</span>
          <span className="detail">
            {exposed.length
              ? `it has signed transactions on ${exposed.map((r) => r.chain.name).join(", ")}, so a quantum computer could derive its private key`
              : "no transactions from this address on these chains. Signatures elsewhere (multisigs, votes, orders) can still reveal it: that's the deep scan."}
          </span>
        </div>
      )}
      <div className="card">
        <h3>
          <span className="mono">{address}</span>
        </h3>
        {!rows ? (
          <span className="spinner" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Chain</th>
                  <th>Status</th>
                  <th>Transactions sent</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.chain.id}>
                    <td>{r.chain.name}</td>
                    <td>
                      <Badge status={r.status} />
                    </td>
                    <td className="num">{r.status === "error" ? "?" : r.nonce}</td>
                    <td className="num">{r.status === "error" ? "?" : `${Number(r.balance).toFixed(4)} ${r.chain.symbol}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card">
        <h3>Public Q-Day registry (Arkiv)</h3>
        {records === null ? <span className="spinner" /> : records.length === 0 ? <p className="note">Nothing published for this address yet.</p> : records.map((r, i) => <div key={i}>{r.kind === "aboard" ? "🛟" : "📌"} {r.text}</div>)}
      </div>
    </div>
  );
}
