// Swarm + Arkiv together: fetch an evidence file from Swarm, hash its bytes, and check it against the Arkiv record(s) that point at it.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { keccak256, type Hex } from "viem";
import { arkivEntityUrl, flagsText, isAuditGrade, isTestAccount, isTestName, short, swarmUrl, type EvidenceRecord, type Flags } from "./lib";

export type { EvidenceRecord };

// ---------- small row parts, shared by Harbour, Check and Home ----------

export function ArkivLink({ entityKey }: { entityKey: string }) {
  return (
    <a className="arkiv-link" href={arkivEntityUrl(entityKey)} target="_blank" rel="noreferrer" title={`Arkiv entity ${entityKey}`}>
      on Arkiv ↗
    </a>
  );
}

export function FlagStamp({ flags }: { flags?: Flags }) {
  if (!flags) return null;
  return (
    <span className={`flag-stamp ${isAuditGrade(flags) ? "" : "open"}`} title="read from the entity's creation flags">
      {flagsText(flags)}
    </span>
  );
}

export function TestTag({ account, name }: { account?: string; name?: string }) {
  if (name ? !isTestName(name) : !isTestAccount(account)) return null;
  return <span className="test-tag">{name ? "Lifeboat test name" : "Lifeboat test account"}</span>;
}

export function EvidenceButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="link-btn ev-btn" onClick={onOpen}>
      open evidence
    </button>
  );
}

// ---------- reading the file ----------

type J = Record<string, unknown>;
const isObj = (x: unknown): x is J => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown) => (typeof x === "string" ? x : undefined);
const toBlock = (x: unknown): string | undefined => {
  if (typeof x === "number" && Number.isFinite(x)) return String(x);
  if (typeof x === "string" && /^0x[0-9a-f]+$/i.test(x)) return BigInt(x).toString();
  if (typeof x === "string" && /^\d+$/.test(x)) return x;
  return undefined;
};
const fmtBlock = (b: string) => Number(b).toLocaleString("en-US");
const normHash = (h: string) => (h.startsWith("0x") ? h : `0x${h}`).toLowerCase();

type FileView = { name?: string; label?: string; address?: string; verdict?: string; status?: string; block?: string; holders?: number; signers?: string; when?: string; leaf?: number };

/** The parts of one evidence object a record can be checked against. */
function view(o: J): FileView {
  const after = isObj(o.after) ? o.after : undefined;
  const receipt = isObj(o.receipt) ? o.receipt : undefined;
  const entries = Array.isArray(o.entries) ? o.entries : undefined;
  const owners = Array.isArray(o.owners) ? o.owners : undefined;
  return {
    name: str(o.name),
    label: str(o.label),
    address: str(o.safe) ?? str(o.address) ?? str(o.naiveAccount) ?? str(o.account) ?? str(o.sender) ?? str(o.pqWallet),
    verdict: str(o.verdict) ?? str(after?.verdict),
    status: typeof o.status === "string" ? o.status : typeof o.takeableWithSignatures === "boolean" ? (o.takeableWithSignatures ? "exposed" : "not-seen") : undefined,
    block: toBlock(o.block) ?? toBlock(o.checkedBlock) ?? toBlock(receipt?.blockNumber) ?? toBlock(after?.block),
    holders: entries ? new Set(entries.map((e) => (isObj(e) && isObj(e.holder) ? str(e.holder.address)?.toLowerCase() : undefined)).filter(Boolean)).size : undefined,
    signers: owners ? `${typeof o.exposedTotal === "number" ? o.exposedTotal : "?"} of ${owners.length} public${typeof o.threshold === "number" ? ` · threshold ${o.threshold}` : ""}` : undefined,
    when: str(o.checkedAt) ?? str(o.savedAt) ?? str(o.scannedAt),
    leaf: typeof o.leaf === "number" ? o.leaf : undefined,
  };
}

type Check = { ok: boolean; text: string };

/** One record against the file: only the fields both sides carry. */
function checksFor(rec: EvidenceRecord, file: FileView | undefined, raw: string, prefix: string): Check[] {
  const out: Check[] = [];
  const p = prefix ? `${prefix}: ` : "";
  if (!file) return [{ ok: false, text: `${p}not found in the file` }];
  if (rec.block && file.block)
    out.push(rec.block === file.block ? { ok: true, text: `${p}block matches (${fmtBlock(rec.block)})` } : { ok: false, text: `${p}block differs: file ${fmtBlock(file.block)}, record ${fmtBlock(rec.block)}` });
  if (rec.verdict && file.verdict)
    out.push(rec.verdict === file.verdict ? { ok: true, text: `${p}verdict matches (${rec.verdict})` } : { ok: false, text: `${p}verdict differs: file ${file.verdict}, record ${rec.verdict}` });
  if (rec.status && file.status)
    out.push(rec.status === file.status ? { ok: true, text: `${p}status matches (${rec.status})` } : { ok: false, text: `${p}status differs: file ${file.status}, record ${rec.status}` });
  if (rec.name && file.name) out.push(rec.name === file.name ? { ok: true, text: `${p}name matches` } : { ok: false, text: `${p}name differs: file ${file.name}` });
  if (rec.address && file.address)
    out.push(rec.address.toLowerCase() === file.address.toLowerCase() ? { ok: true, text: `${p}address matches` } : { ok: false, text: `${p}address differs: file ${short(file.address)}` });
  if (rec.txHash && /^0x[0-9a-f]{64}$/i.test(rec.txHash))
    out.push(raw.toLowerCase().includes(rec.txHash.toLowerCase()) ? { ok: true, text: `${p}transaction ${short(rec.txHash, 6)} is in the file` } : { ok: false, text: `${p}transaction ${short(rec.txHash, 6)} is not in the file` });
  return out;
}

type Loaded = { hash: Hex; size: number; raw: string; json: unknown };

/**
 * The evidence drawer. `records` are the Arkiv entities that name this Swarm file; null while the caller is still looking them up.
 */
export default function EvidenceDrawer({ swarmRef, records, title, onClose }: { swarmRef: string; records: EvidenceRecord[] | null; title?: string; onClose: () => void }) {
  const [file, setFile] = useState<Loaded | null>(null);
  const [err, setErr] = useState("");
  const [attempt, setAttempt] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    setFile(null);
    setErr("");
    fetch(swarmUrl(swarmRef), { signal: ctl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`gateway answered ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const raw = new TextDecoder().decode(bytes);
        let json: unknown = undefined;
        try {
          json = JSON.parse(raw);
        } catch {
          // not JSON: the hash still stands, there are just no facts to read
        }
        setFile({ hash: keccak256(bytes), size: bytes.length, raw, json });
      })
      .catch((e) => !ctl.signal.aborted && setErr(String((e as Error)?.message ?? e).slice(0, 160)));
    return () => ctl.abort();
  }, [swarmRef, attempt]);

  const recs = records ?? [];
  const results = file && isObj(file.json) && Array.isArray(file.json.results) ? (file.json.results.filter(isObj) as J[]) : undefined;

  // For a file that holds many results (the council scan), each record is matched to its own entry by address.
  const entryFor = (rec: EvidenceRecord): FileView | undefined => {
    if (!file || !isObj(file.json)) return undefined;
    if (!results) return view(file.json);
    const hit = results.find((r) => rec.address && view(r).address?.toLowerCase() === rec.address.toLowerCase());
    return hit ? view(hit) : undefined;
  };

  const facts = useMemo(() => {
    if (!file || !isObj(file.json)) return [] as { k: string; v: ReactNode }[];
    const out: { k: string; v: ReactNode }[] = [];
    const one = recs.length === 1 ? recs[0] : undefined;
    const f = results ? (one ? entryFor(one) : undefined) : view(file.json);
    if (results && !f) {
      const blocks = results.map((r) => view(r).block).filter((b): b is string => !!b).map(Number);
      out.push({ k: "Entries", v: `${results.length} in one file` });
      const labels = results.map((r) => view(r).label).filter(Boolean);
      if (labels.length) out.push({ k: "Covers", v: labels.join(" · ") });
      if (blocks.length) out.push({ k: "Blocks", v: blocks.length > 1 && Math.min(...blocks) !== Math.max(...blocks) ? `${Math.min(...blocks).toLocaleString("en-US")}–${Math.max(...blocks).toLocaleString("en-US")}` : Math.min(...blocks).toLocaleString("en-US") });
      const exposed = results.filter((r) => view(r).status === "exposed").length;
      if (results.some((r) => view(r).status)) out.push({ k: "Status", v: `${exposed} of ${results.length} exposed` });
      const when = view(file.json).when;
      if (when) out.push({ k: "Saved", v: new Date(when).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) });
    } else if (f) {
      if (f.name)
        out.push({
          k: "Name",
          v: (
            <>
              {f.name} <TestTag name={f.name} />
            </>
          ),
        });
      if (f.label) out.push({ k: "Label", v: f.label });
      if (f.address)
        out.push({
          k: "Address",
          v: (
            <>
              {short(f.address, 8)} <TestTag account={f.address} />
            </>
          ),
        });
      if (f.verdict) out.push({ k: "Verdict", v: f.verdict });
      if (f.status) out.push({ k: "Status", v: f.status });
      if (f.block) out.push({ k: "Block", v: fmtBlock(f.block) });
      if (f.holders !== undefined) out.push({ k: "Role holders", v: `${f.holders} keys` });
      if (f.signers) out.push({ k: "Signer keys", v: f.signers });
      if (f.leaf !== undefined && out.length < 6) out.push({ k: "Leaf", v: `#${f.leaf}` });
      if (f.when && out.length < 6) out.push({ k: "Saved", v: new Date(f.when).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) });
    }
    if (out.length < 3) out.push({ k: "Size", v: `${(file.size / 1024).toFixed(1)} kB` });
    return out.slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, records]);

  const checks = useMemo(() => {
    if (!file || !isObj(file.json)) return [] as Check[];
    return recs.flatMap((r) => checksFor(r, entryFor(r), file.raw, recs.length > 1 ? short(r.address ?? r.key, 4) : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, records]);

  // The seal: the file's keccak256 against the evidenceHash each record carries.
  const hashed = recs.filter((r) => r.evidenceHash);
  const differs = file ? hashed.filter((r) => normHash(r.evidenceHash!) !== file.hash.toLowerCase()) : [];
  const seal: "good" | "bad" | "neutral" = !file || !hashed.length ? "neutral" : differs.length ? "bad" : "good";

  // A portal, so a transformed or animated ancestor (the luggage tag) can never trap the fixed-position drawer.
  return createPortal(
    <>
      <div className="drawer-back" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Evidence">
        <div className="board-head">
          <h3>Evidence</h3>
          <button type="button" ref={closeRef} className="drawer-x" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="drawer-body">
          <div>
            <div className="label">Swarm file · Arkiv record</div>
            {title && <div className="drawer-title">{title}</div>}
          </div>

          {err ? (
            <div className="error-box">
              The Swarm gateway didn't return the file: {err}.{" "}
              <button type="button" className="link-btn" onClick={() => setAttempt((a) => a + 1)}>
                Try again
              </button>
            </div>
          ) : !file ? (
            <p className="note">Fetching the file from Swarm and hashing it…</p>
          ) : (
            <div className={`ev-seal ${seal}`}>
              <span className={`rubber ${seal}`}>{seal === "good" ? "Matches" : seal === "bad" ? "Differs" : "No hash"}</span>
              <div className="big">
                {seal === "good"
                  ? `Swarm file matches the Arkiv record${hashed.length > 1 ? `s (${hashed.length})` : ""}`
                  : seal === "bad"
                    ? "File differs from the record"
                    : records === null
                      ? "Looking up the Arkiv record…"
                      : recs.length === 0
                        ? "No live Arkiv record names this file"
                        : recs.length > 1
                          ? `These ${recs.length} records have no hash (published before hashes)`
                          : "This record has no hash (published before hashes)"}
              </div>
              <div className="mono muted">
                {seal === "good" ? (
                  <>hash {short(file.hash, 10)}</>
                ) : seal === "bad" ? (
                  <>
                    record {short(normHash(differs[0]!.evidenceHash!), 10)} · file {short(file.hash, 10)}
                  </>
                ) : (
                  <>file hash {short(file.hash, 10)}</>
                )}
              </div>
              <div className="note">keccak256 of the {(file.size / 1024).toFixed(1)} kB file, computed in your browser.</div>
            </div>
          )}

          {file && facts.length > 0 && (
            <div className="facts">
              {facts.map((f) => (
                <div key={f.k}>
                  <span className="k">{f.k}</span>
                  <span className="v">{f.v}</span>
                </div>
              ))}
            </div>
          )}

          {file && recs.length > 0 && (
            <div>
              <div className="label" style={{ marginBottom: 6 }}>
                File vs record
              </div>
              {checks.length ? (
                <ul className="checks">
                  {checks.map((c, i) => (
                    <li key={i} className={c.ok ? "ok" : "diff"}>
                      {c.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="note">This file carries no field the record names.</p>
              )}
            </div>
          )}

          <div className="drawer-links">
            {recs.map((r) => (
              <ArkivLink key={r.key} entityKey={r.key} />
            ))}
            <a className="arkiv-link" href={swarmUrl(swarmRef)} target="_blank" rel="noreferrer">
              Swarm file ↗
            </a>
            <span className="mono faint">{short(swarmRef, 8)}</span>
          </div>

          {file && (
            <details className="raw">
              <summary>Raw file</summary>
              <pre>{file.raw.length > 6000 ? `${file.raw.slice(0, 6000)}\n…` : file.raw}</pre>
            </details>
          )}
        </div>
      </aside>
    </>,
    document.body,
  );
}
