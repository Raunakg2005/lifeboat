import { REPO } from "./lib";

/** Shor's algorithm for the elliptic-curve discrete log at toy scale: hardware runs if present, else the noisy simulation. */
type Run = { shots: number; twoQubitGates?: number; depth?: number; recoveredKey: number | null; verified: boolean; votes: Record<string, number>; voteShare: number; onLatticeShare: number; randomGuessShare: number };
type Common = { bits: number; secretKey: number; p: number; a: number; b: number; G: number[]; order: number; publicKey: number[] | string };
type Sim = Common & { kind: "simulation"; runs: Record<string, Run> };
type Hw = Common & Run & { kind: "ibm-quantum"; backend: string; jobId: string; quantumSeconds?: number; finishedAt?: string };

const files = import.meta.glob<{ default: Sim | Hw }>("../../evidence/quantum/*.json", { eager: true });
const all = Object.entries(files)
  .filter(([path]) => !path.includes("pending"))
  .map(([, m]) => m.default);
const hw = (bits: number) => all.filter((e): e is Hw => e.kind === "ibm-quantum" && e.bits === bits && e.verified !== undefined).sort((x, y) => String(y.finishedAt).localeCompare(String(x.finishedAt)))[0];
const sim = (bits: number) => all.find((e): e is Sim => e.kind === "simulation" && e.bits === bits);

export const quantumHardwareRuns = () => [2, 3].map(hw).filter((x): x is Hw => !!x);

const curve = (e: Common) => `y² = x³ + ${e.a === 1 ? "" : e.a}x + ${e.b} over F${String(e.p).replace(/\d/g, (d) => "₀₁₂₃₄₅₆₇₈₉"[+d])}`;
const pt = (p: number[] | string) => (typeof p === "string" ? p : `(${p.join(", ")})`);
const pct = (x: number) => `${Math.round(x * 100)}%`;

function Card({ bits }: { bits: number }) {
  const h = hw(bits);
  const s = sim(bits);
  const base = h ?? s;
  if (!base) return null;
  const run: Run | undefined = h ?? s?.runs["noisy-FakeTorino"];
  if (!run) return null;
  const r = 2 ** bits;
  const max = Math.max(1, ...Object.values(run.votes));
  return (
    <div className="qcard">
      <div className="qhead">
        <span className="stencil">{bits}-bit key</span>
        <span className={`pill ${h ? "pq" : "contract"}`}>{h ? `real hardware · ${h.backend}` : "noisy simulation · IBM Torino model"}</span>
      </div>
      <div className="qrows">
        <div>
          <span className="label">Toy curve ({r} points)</span>
          <b>{curve(base)}</b>
        </div>
        <div>
          <span className="label">Public key Q (the input)</span>
          <b className="mono">{pt(base.publicKey)}</b>
        </div>
        <div>
          <span className="label">Private key the circuit returned</span>
          <b className="qkey">
            k = {run.recoveredKey ?? "?"} {run.verified ? <span className="ok">✓ k·G = Q</span> : <span className="bad">✗</span>}
          </b>
        </div>
      </div>
      <div className="label" style={{ marginTop: 10 }}>
        Votes for each candidate key ({run.shots.toLocaleString("en-US")} shots)
      </div>
      <div className="bars" style={{ gridTemplateColumns: `repeat(${r}, 1fr)` }}>
        {Array.from({ length: r }, (_, k) => {
          const v = run.votes[String(k)] ?? 0;
          return (
            <div key={k} className={`bar ${k === run.recoveredKey ? "win" : ""}`}>
              <div className="fill" style={{ height: `${(v / max) * 100}%` }} />
              <span>{k}</span>
            </div>
          );
        })}
      </div>
      <p className="note" style={{ marginBottom: 0 }}>
        {pct(run.onLatticeShare)} of shots land on the answer's pattern, against {pct(run.randomGuessShare)} for random noise
        {run.twoQubitGates ? ` · ${run.twoQubitGates} two-qubit gates` : ""}
        {h?.quantumSeconds ? ` · ${h.quantumSeconds} s of QPU time` : ""}
        {h ? (
          <>
            {" "}
            · job <span className="mono">{h.jobId}</span>
          </>
        ) : (
          " · hardware run pending"
        )}
      </p>
    </div>
  );
}

export default function QuantumPanel() {
  if (!sim(2) && !hw(2)) return null;
  const onHardware = quantumHardwareRuns().length > 0;
  return (
    <section className="section">
      <div className="board">
        <div className="board-head">
          <h3>Public key → private key</h3>
          <span className="label">Shor's algorithm · IBM quantum computer · toy scale</span>
        </div>
        <div className="board-body">
          <p style={{ marginTop: 0 }}>
            Why a public key on-chain matters: {onHardware ? "we gave an IBM quantum computer" : "we built Shor’s algorithm for a toy elliptic curve and gave it"} <b>only the public key</b>, and it returned the{" "}
            <b>private key</b>. It’s the same attack a large quantum computer would run on an Ethereum key, scaled down from 256 bits to 2 and 3.
            {onHardware ? "" : " Shown here with IBM’s noise model for its Torino processor; the run on real IBM hardware is next."}
          </p>
          <div className="grid cols-2">
            <Card bits={2} />
            <Card bits={3} />
          </div>
          <p className="note" style={{ marginBottom: 0 }}>
            A classical computer solves these toy keys instantly, and the circuit is compiled from the toy curve's addition table, which only works because the curve is tiny. A real key needs the curve
            arithmetic built from quantum gates: Google's 2026 estimate is about 1,200 error-corrected logical qubits. No quantum computer can do that today. Method and raw results:{" "}
            <a href={`${REPO}/blob/main/docs/quantum-demo.md`} target="_blank" rel="noreferrer">
              quantum-demo.md
            </a>
            .
          </p>
        </div>
      </div>
    </section>
  );
}
