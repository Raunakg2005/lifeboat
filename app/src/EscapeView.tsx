import { useEffect, useState } from "react";
import first from "../../evidence/ef/frame-demo-leaf1.json";
import rescue from "../../evidence/ef/rescue.json";
import guards from "../../evidence/ef/paymaster-guards.json";
import { REPO, explorerTx, short } from "./lib";
import { Badge, Boat } from "./ui";

const verifyGas = parseInt(first.simulation.frames[0]!.gasUsed, 16);
const rescueFrames = rescue.simulation.frames.map((f: { gasUsed: string }) => parseInt(f.gasUsed, 16));
const strip = (m: string) => m.replace(/^[a-zA-Z_]+ @ [^:]+: /, "").replace(/^Invalid params: /, "");

function CountUp({ to, ms = 1200 }: { to: number; ms?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return setV(to);
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <>{v.toLocaleString()}</>;
}

export default function EscapeView() {
  const [run, setRun] = useState(0);
  return (
    <div className="wrap">
      <div className="page-head">
        <span className="eyebrow">EIP-8141 · ERC-8421 alt mempool</span>
        <h2>The way out: a post-quantum account that works today</h2>
        <p>Frame transactions let an account check any signature in a VERIFY frame. Ours checks a WOTS+C hash-based signature, with no ECDSA anywhere, written in Yul and live on the devnet.</p>
      </div>

      <div className="grid cols-4 section">
        <div className="panel stat">
          <div className="v">
            <CountUp to={verifyGas} />
          </div>
          <div className="k">gas for the whole VERIFY frame, under the 100,000 cap</div>
        </div>
        <div className="panel stat">
          <div className="v">
            <CountUp to={44870} />
          </div>
          <div className="k">gas for the WOTS+C check itself: identical for every signature</div>
        </div>
        <div className="panel stat">
          <div className="v">
            <CountUp to={400} />
            <small> hashes</small>
          </div>
          <div className="k">per check. The digest's digits always sum to 560, so no checksum chains</div>
        </div>
        <div className="panel stat">
          <div className="v">
            <CountUp to={256} />
            <small> keys</small>
          </div>
          <div className="k">one-time keys per account. A fresh one per signing attempt, burned on-chain once used</div>
        </div>
      </div>

      <div className="panel section">
        <h3>First transaction, through the alt mempool</h3>
        <a href={explorerTx(first.txHash)} target="_blank" rel="noreferrer" className="mono" style={{ wordBreak: "break-all" }}>
          {first.txHash}
        </a>
        <div className="note" style={{ marginTop: 6 }}>
          Chain 1337 · block {parseInt(first.receipt.blockNumber, 16).toLocaleString()} · status success · witness {first.witnessBytes.toLocaleString()} bytes · leaf {first.leaf} (leaf 0 was revealed to a dry-run, so it's
          never used again)
        </div>
      </div>

      <div className="section">
        <h3 className="section-title">
          <span className="num">RESCUE</span> A wallet with tokens but no ETH escapes anyway
        </h3>
        <p className="muted" style={{ marginTop: 0, maxWidth: 820 }}>
          A staked paymaster pays the gas and is repaid in USDC in the same transaction. To decide, it must read shared state: its registry of exposed accounts, and the token balance through an upgradeable proxy.
          Only the alt mempool allows that, and only for a staked sponsor. The same signed transaction, three mempools:
        </p>
        <div className="panel lanes" key={run}>
          <div className="lane blocked">
            <div className="who">
              Public mempool<small>canonical rules</small>
            </div>
            <div className="channel">
              <div className="tx">
                <Boat size={56} />
              </div>
              <div className="gate" />
              <div className="reason">✕ {strip(rescue.canonical.message)}</div>
            </div>
          </div>
          <div className="lane blocked">
            <div className="who">
              Alt mempool<small>paymaster not staked</small>
            </div>
            <div className="channel">
              <div className="tx">
                <Boat size={56} />
              </div>
              <div className="gate" />
              <div className="reason">✕ {strip(rescue.altUnstaked.message).replace(/0x0+(\d+)$/, "0x…$1")}</div>
            </div>
          </div>
          <div className="lane passed">
            <div className="who">
              Alt mempool<small>paymaster staked (0.012 ETH)</small>
            </div>
            <div className="channel">
              <div className="tx">
                <Boat size={56} />
              </div>
              <div className="gate" />
              <div className="reason">✓ included in block {parseInt(rescue.receipt.blockNumber, 16).toLocaleString()}</div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <a href={explorerTx(rescue.altStaked.hash)} target="_blank" rel="noreferrer" className="mono">
              {short(rescue.altStaked.hash, 10)} on the explorer ↗
            </a>
            <button className="chip" onClick={() => setRun((r) => r + 1)}>
              ↻ replay
            </button>
          </div>
        </div>
      </div>

      <div className="grid cols-2 section">
        <div className="panel">
          <h3>Before → after</h3>
          <table>
            <tbody>
              <tr>
                <td>Exposed wallet</td>
                <td className="num">
                  {rescue.before.eoaEth} ETH · {rescue.before.eoaUsdc} mUSDC → <b>{rescue.after.eoaUsdc} mUSDC</b>
                </td>
              </tr>
              <tr>
                <td>Post-quantum account</td>
                <td className="num">
                  {rescue.before.destUsdc} → <b style={{ color: "var(--green)" }}>{rescue.after.destUsdc} mUSDC</b>
                </td>
              </tr>
              <tr>
                <td>Paymaster</td>
                <td className="num">repaid {rescue.after.paymasterUsdc} mUSDC</td>
              </tr>
            </tbody>
          </table>
          <p className="note">Frame gas: {rescueFrames.map((g: number) => g.toLocaleString()).join(" · ")} (the sponsor's check is the 2nd frame)</p>
        </div>
        <div className="panel">
          <h3>The sponsor can't be cheated</h3>
          <table>
            <tbody>
              {guards.cases.map((c: { name: string; paymasterApproved: boolean }) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td style={{ textAlign: "right" }}>{c.paymasterApproved ? <Badge status="ok">pays</Badge> : <Badge status="exposed">refuses</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">Dry-runs on the live devnet, each changing one thing.</p>
        </div>
      </div>
      <p className="note section">
        Design, gas and trade-offs: <a href={`${REPO}/blob/main/docs/pq-account.md`}>pq-account.md</a> · <a href={`${REPO}/blob/main/docs/rescue-paymaster.md`}>rescue-paymaster.md</a>
      </p>
    </div>
  );
}
