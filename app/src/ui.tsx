import type { ReactNode } from "react";

export const STATUS_COLOR: Record<string, string> = {
  exposed: "#ff5468",
  "not-seen": "#ffbf47",
  "pq-wallet": "#3ee6a5",
  pq: "#3ee6a5",
  contract: "#9fb0c8",
  none: "#1f8f68",
  error: "#5f7594",
};
const LABEL: Record<string, string> = { exposed: "key on-chain", "not-seen": "not seen", "pq-wallet": "post-quantum", pq: "post-quantum", contract: "contract", error: "unreachable", ok: "ok" };

export function Badge({ status, children }: { status: string; children?: ReactNode }) {
  return (
    <span className={`badge ${status}`}>
      <span className="dot" />
      {children ?? LABEL[status] ?? status}
    </span>
  );
}

const waveSvg = (fill: string, amp: number, phase: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 170' preserveAspectRatio='none'><path d='M0 ${80 + phase} C 133 ${80 - amp + phase}, 266 ${80 + amp + phase}, 400 ${80 + phase} S 666 ${80 - amp + phase}, 800 ${80 + phase} V170 H0Z' fill='${fill}'/></svg>`,
  )}")`;

export function Boat({ size = 120 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 90" width={size} aria-hidden="true">
      <path d="M58 8v52" stroke="#e8f0fb" strokeWidth="3" />
      <path d="M61 10l34 40H61z" fill="#ff6a2b" />
      <path d="M55 18L28 50h27z" fill="#ffd2bd" opacity=".9" />
      <path d="M10 58h100l-14 22H24z" fill="#ff6a2b" />
      <path d="M16 64h88" stroke="#ffb08a" strokeWidth="2" />
      <circle cx="40" cy="70" r="3" fill="#fff" opacity=".85" />
      <circle cx="60" cy="70" r="3" fill="#fff" opacity=".85" />
      <circle cx="80" cy="70" r="3" fill="#fff" opacity=".85" />
    </svg>
  );
}

export function Ocean() {
  return (
    <div className="ocean" aria-hidden="true">
      <div className="boat">
        <Boat />
      </div>
      <div className="wave w1" style={{ backgroundImage: waveSvg("#0f3a6b", 22, 0) }} />
      <div className="wave w2" style={{ backgroundImage: waveSvg("#0b2a52", 16, 18) }} />
      <div className="wave w3" style={{ backgroundImage: waveSvg("#020814", 12, 42) }} />
    </div>
  );
}

export type Blip = { id: string; color: "red" | "green" | "amber" };

/** Deterministic position for a blip from its id (an address), inside the disc. */
function place(id: string, i: number) {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const angle = ((h >>> 0) % 360) * (Math.PI / 180);
  const r = 18 + (((h >>> 9) % 1000) / 1000) * 26 + (i % 3);
  return { left: `${50 + r * Math.cos(angle)}%`, top: `${50 + r * Math.sin(angle)}%` };
}

export function Sonar({ scanning, blips, label }: { scanning: boolean; blips: Blip[]; label: string }) {
  return (
    <div className={`sonar ${scanning ? "fast" : ""}`} aria-hidden="true">
      <div className="disc" />
      <div className="ring r1" />
      <div className="ring r2" />
      <div className="ring r3" />
      <div className="cross" />
      <div className="sweep" />
      {blips.map((b, i) => (
        <span key={b.id + i} className={`blip ${b.color}`} style={{ ...place(b.id, i), animationDelay: `${(i % 7) * 0.35}s` }} />
      ))}
      <div className="core" />
      <div className="label">{label}</div>
    </div>
  );
}

export function Stamp({ tone, children }: { tone: "bad" | "good" | "unknown"; children: ReactNode }) {
  return <span className={`stamp ${tone}`}>{children}</span>;
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

/** A small ring showing how much of an entry's lifetime is left. */
export function ExpiryRing({ fraction, label }: { fraction: number; label: string }) {
  const f = Math.max(0, Math.min(1, fraction));
  const c = 2 * Math.PI * 8;
  return (
    <span className="ring-wrap">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="8" fill="none" stroke="rgb(120 170 230 / 20%)" strokeWidth="3" />
        <circle cx="10" cy="10" r="8" fill="none" stroke={f > 0.25 ? "#5ad1ff" : "#ffbf47"} strokeWidth="3" strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 10 10)" strokeLinecap="round" />
      </svg>
      {label}
    </span>
  );
}

export type SpokeState = { path: number; label: string; color: string };

/** A ship's wheel: one handle per control path, coloured by the worst key on that path. */
export function HelmWheel({ spokes, active, onSelect, center }: { spokes: SpokeState[]; active: number | null; onSelect: (p: number) => void; center: string }) {
  const cx = 200;
  const cy = 200;
  const angle = (i: number) => ((-90 + i * 72) * Math.PI) / 180;
  return (
    <div className="helm-wheel">
      <svg className="helm-svg" viewBox="0 0 400 400" role="img" aria-label="Helm wheel: five control paths">
        <defs>
          <radialGradient id="wood" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#3b2614" />
            <stop offset="100%" stopColor="#1a1008" />
          </radialGradient>
        </defs>
        <g className="helm-turn">
          {spokes.map((s, i) => (
            <line key={`sp${s.path}`} className="spoke" x1={cx} y1={cy} x2={cx + 172 * Math.cos(angle(i))} y2={cy + 172 * Math.sin(angle(i))} />
          ))}
          {spokes.map((_, i) => {
            const a = angle(i) + (36 * Math.PI) / 180;
            return <line key={`mid${i}`} className="spoke" style={{ strokeWidth: 4, opacity: 0.7 }} x1={cx + 40 * Math.cos(a)} y1={cy + 40 * Math.sin(a)} x2={cx + 130 * Math.cos(a)} y2={cy + 130 * Math.sin(a)} />;
          })}
          <circle className="rim" cx={cx} cy={cy} r="130" />
          <circle className="rim-inner" cx={cx} cy={cy} r="118" />
          <circle className="rim-inner" cx={cx} cy={cy} r="142" />
          <circle className="hub" cx={cx} cy={cy} r="40" fill="url(#wood)" />
          <circle cx={cx} cy={cy} r="10" fill="#ff6a2b" />
          {spokes.map((s, i) => {
            const x = cx + 172 * Math.cos(angle(i));
            const y = cy + 172 * Math.sin(angle(i));
            return (
              <g key={`h${s.path}`} className={`handle ${active === s.path ? "active" : ""}`} onClick={() => onSelect(s.path)} role="button" aria-label={`Path ${s.path}: ${s.label}`}>
                <circle cx={x} cy={y} r="22" fill={s.color} stroke="#0b1b33" style={{ filter: `drop-shadow(0 0 10px ${s.color})` }} />
                <text x={x} y={y}>
                  {s.path}
                </text>
              </g>
            );
          })}
        </g>
        <text x={cx} y={cy + 66} textAnchor="middle" style={{ fontFamily: "var(--mono)", fontSize: 13, fill: "#e8f0fb" }}>
          {center.length > 24 ? center.slice(0, 22) + "…" : center}
        </text>
      </svg>
      <div className="legend">
        <span>
          <i style={{ background: STATUS_COLOR.exposed }} /> key on-chain
        </span>
        <span>
          <i style={{ background: STATUS_COLOR["not-seen"] }} /> not seen
        </span>
        <span>
          <i style={{ background: STATUS_COLOR.contract }} /> contract
        </span>
        <span>
          <i style={{ background: STATUS_COLOR.pq }} /> post-quantum
        </span>
        <span>
          <i style={{ background: STATUS_COLOR.none }} /> nobody
        </span>
      </div>
    </div>
  );
}

export function Seal({ good }: { good: boolean }) {
  return (
    <svg className="ico" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="28" fill="none" stroke={good ? "#3ee6a5" : "#ff5468"} strokeWidth="3" strokeDasharray="4 3" />
      <circle cx="32" cy="32" r="21" fill={good ? "rgb(62 230 165 / 15%)" : "rgb(255 84 104 / 18%)"} />
      {good ? <path d="M22 33l7 7 14-16" stroke="#3ee6a5" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M24 24l16 16M40 24L24 40" stroke="#ff5468" strokeWidth="4" strokeLinecap="round" />}
    </svg>
  );
}
