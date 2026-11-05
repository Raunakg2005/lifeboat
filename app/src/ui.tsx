import type { ReactNode } from "react";

/** Fill colours per key status (harbour palette). */
export const STATUS_FILL: Record<string, string> = {
  exposed: "#f05a1a",
  "not-seen": "#d8e9f5",
  "pq-wallet": "#1d8a5b",
  pq: "#1d8a5b",
  contract: "#e3e0d9",
  none: "#f2eee6",
};
const LABEL: Record<string, string> = { exposed: "exposed", "not-seen": "not seen", "pq-wallet": "post-quantum", pq: "post-quantum", contract: "contract", error: "unreachable", ok: "ok" };

export function Pill({ status, children }: { status: string; children?: ReactNode }) {
  return <span className={`pill ${status}`}>{children ?? LABEL[status] ?? status}</span>;
}

export function Boat({ width = 76 }: { width?: number }) {
  return (
    <svg viewBox="0 0 80 52" width={width} aria-hidden="true">
      <path d="M38 4v30" stroke="#0b1f33" strokeWidth="2.5" />
      <path d="M40 6l20 24H40z" fill="#f2eee6" stroke="#0b1f33" strokeWidth="2" strokeLinejoin="round" />
      <path d="M6 34h68l-9 14H15z" fill="#f05a1a" stroke="#0b1f33" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M11 39h58" stroke="#0b1f33" strokeWidth="1.5" />
      <circle cx="28" cy="43" r="2" fill="#0b1f33" />
      <circle cx="40" cy="43" r="2" fill="#0b1f33" />
      <circle cx="52" cy="43" r="2" fill="#0b1f33" />
    </svg>
  );
}

const wave = (fill: string, y: number, amp: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 64' preserveAspectRatio='none'><path d='M0 ${y} Q 75 ${y - amp} 150 ${y} T 300 ${y} T 450 ${y} T 600 ${y} V64 H0Z' fill='${fill}'/></svg>`)}")`;

/** The strip under the top bar: hazard stripes, then waves with a lifeboat sailing across. */
export function WaveBand() {
  return (
    <>
      <div className="hazard" />
      <div className="waveband" aria-hidden="true">
        <div className="wave wa" style={{ backgroundImage: wave("#a9cfe9", 30, 10) }} />
        <div className="sail">
          <Boat />
        </div>
        <div className="wave wb" style={{ backgroundImage: wave("#5a93c4", 42, 8) }} />
        <div className="wave wc" style={{ backgroundImage: wave("#1d4f86", 54, 6) }} />
      </div>
    </>
  );
}

/** A luggage tag: a coloured stub with a punched hole and a stencilled verdict, then the details. */
export function LuggageTag({ tone, verdict, id, meta, children }: { tone: "bad" | "good" | "unknown" | "neutral"; verdict: string; id: ReactNode; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className="ltag">
      <div className={`stub ${tone === "bad" ? "" : tone}`}>
        <span>{verdict}</span>
      </div>
      <div className="body">
        <div className="top">
          <span className="id">{id}</span>
          {meta && <span className="meta">{meta}</span>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Radar() {
  return <div className="radar" aria-hidden="true" />;
}

export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ul className="steps">
      {steps.map((s, i) => (
        <li key={s} className={i < current ? "done" : i === current ? "now" : ""}>
          {s}
        </li>
      ))}
    </ul>
  );
}

export function Rubber({ good, children }: { good: boolean; children: ReactNode }) {
  return <span className={`rubber ${good ? "good" : "bad"}`}>{children}</span>;
}

export function Ring({ fraction, label }: { fraction: number; label: string }) {
  const f = Math.max(0, Math.min(1, fraction));
  const c = 2 * Math.PI * 7;
  return (
    <span className="ring">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r="7" fill="none" stroke="#e8e2d6" strokeWidth="3" />
        <circle cx="9" cy="9" r="7" fill="none" stroke={f > 0.25 ? "#0b1f33" : "#f05a1a"} strokeWidth="3" strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 9 9)" />
      </svg>
      {label}
    </span>
  );
}

export type SpokeState = { path: number; label: string; fill: string };

/** A ship's wheel in navy ink: one handle per control path, filled by the worst key on it. */
export function HelmWheel({ spokes, active, onSelect, center }: { spokes: SpokeState[]; active: number | null; onSelect: (p: number) => void; center: string }) {
  const c = 200;
  const ang = (i: number) => ((-90 + i * 72) * Math.PI) / 180;
  const pt = (r: number, a: number) => [c + r * Math.cos(a), c + r * Math.sin(a)] as const;
  return (
    <div className="helm-wheel">
      <svg className="helm-svg" viewBox="0 0 400 400" role="img" aria-label="Helm wheel: five control paths">
        <g className="helm-turn">
          {spokes.map((s, i) => {
            const [x1, y1] = pt(44, ang(i));
            const [x2, y2] = pt(150, ang(i));
            return <line key={`s${s.path}`} className="ink" x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="9" strokeLinecap="square" />;
          })}
          {spokes.map((_, i) => {
            const a = ang(i) + (36 * Math.PI) / 180;
            const [x1, y1] = pt(44, a);
            const [x2, y2] = pt(118, a);
            return <line key={`m${i}`} className="ink" x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="4" />;
          })}
          <circle className="ink" cx={c} cy={c} r="124" strokeWidth="14" />
          <circle cx={c} cy={c} r="124" fill="none" stroke="#f2eee6" strokeWidth="4" strokeDasharray="2 14" />
          <circle cx={c} cy={c} r="44" fill="#f2eee6" stroke="#0b1f33" strokeWidth="6" />
          <circle cx={c} cy={c} r="14" fill="#f05a1a" stroke="#0b1f33" strokeWidth="3" />
          {spokes.map((s, i) => {
            const [x, y] = pt(170, ang(i));
            const dark = s.fill === STATUS_FILL.exposed || s.fill === STATUS_FILL.pq;
            return (
              <g key={`h${s.path}`} className="handle" onClick={() => onSelect(s.path)} role="button" aria-label={`Path ${s.path}: ${s.label}`}>
                <line className="ink" x1={pt(150, ang(i))[0]} y1={pt(150, ang(i))[1]} x2={x} y2={y} strokeWidth="9" />
                <circle cx={x} cy={y} r={active === s.path ? 27 : 24} fill={s.fill} stroke="#0b1f33" strokeWidth="4" />
                <text x={x} y={y} fill={dark && s.fill === STATUS_FILL.pq ? "#fff" : "#0b1f33"}>
                  {s.path}
                </text>
              </g>
            );
          })}
        </g>
        <rect x={c - 92} y={c + 56} width="184" height="26" fill="#0b1f33" />
        <text x={c} y={c + 70} textAnchor="middle" dominantBaseline="central" style={{ fontFamily: "var(--mono)", fontSize: 12.5, fill: "#f2eee6" }}>
          {center.length > 24 ? center.slice(0, 22) + "…" : center}
        </text>
      </svg>
      <div className="legend">
        <Pill status="exposed" />
        <Pill status="not-seen" />
        <Pill status="contract" />
        <Pill status="pq" />
        <span className="pill" style={{ background: STATUS_FILL.none }}>
          nobody
        </span>
      </div>
    </div>
  );
}
