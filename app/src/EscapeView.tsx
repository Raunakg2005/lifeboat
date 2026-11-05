import { useEffect, useState } from "react";
import first from "../../evidence/ef/frame-demo-leaf1.json";
import rescue from "../../evidence/ef/rescue.json";
import guards from "../../evidence/ef/paymaster-guards.json";
import { REPO, explorerTx, short } from "./lib";
import { Boat, LuggageTag, Pill } from "./ui";

const verifyGas = parseInt(first.simulation.frames[0]!.gasUsed, 16);
const rescueFrames = rescue.simulation.frames.map((f: { gasUsed: string }) => parseInt(f.gasUsed, 16));
const strip = (m: string) => m.replace(/^[a-zA-Z_]+ @ [^:]+: /, "").replace(/^Invalid params: /, "");

function CountUp({ to, ms = 1100 }: { to: number; ms?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setV(to);
      return;
    }
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
    <>
      <section className="section" style={{ marginTop: 26 }}>
        <div className="label">EIP-8141 frame transactions · ERC-8421 alt mempool</div>
        <h2>
          The way <span className="o">out</span>
        </h2>
        <p className="lead">
          A post-quantum account that works today. Frame transactions let an account check any signature in a VERIFY frame. Ours checks a WOTS+C hash-based signature, with no ECDSA anywhere, written in Yul
          and live on the devnet.
        </p>
        <div className="grid cols-4">
          <div className="tile">
            <div className="v">
              <CountUp to={verifyGas} />
            </div>
            <div className="k">gas for the whole VERIFY frame. The cap is 100,000</div>
          </div>
          <div className="tile">
            <div className="v">
              <CountUp to={44870} />
            </div>
            <div className="k">gas for the WOTS+C check itself, the same for every signature</div>
          </div>
          <div className="tile">
            <div className="v">
              <CountUp to={400} />
              <small> hashes</small>
            </div>
            <div className="k">per check: the digest's digits always sum to 560, so no checksum chains</div>
          </div>
          <div className="tile">
            <div className="v">
              <CountUp to={256} />
              <small> keys</small>
            </div>
            <div className="k">one-time keys per account; each used once, then burned on-chain</div>
          </div>
        </div>
      </section>

      <section className="section">
        <LuggageTag tone="good" verdict="On chain" id="First post-quantum transaction" meta={`chain 1337 · block ${parseInt(first.receipt.blockNumber, 16).toLocaleString()}`}>
          <p className="desc">
            Signed with a one-time WOTS+C key (leaf {first.leaf}; leaf 0 was revealed to a dry-run, so it's never used again), sent through the ERC-8421 alt-mempool gateway, and included with status success.
            Witness: {first.witnessBytes.toLocaleString()} bytes.
          </p>
          <a className="mono" href={explorerTx(first.txHash)} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all" }}>
            {first.txHash}
          </a>
        </LuggageTag>
      </section>

      <section className="section">
        <div className="label">The rescue</div>
        <h2>
          No ETH? <span className="o">No problem.</span>
        </h2>
        <p className="lead">
          An exposed wallet holds tokens but no ETH for gas. A staked paymaster pays, and is repaid in USDC inside the same transaction. To decide, it must read shared state: its registry of exposed
          accounts, and the token balance through an upgradeable proxy. Only the alt mempool allows that, and only for a staked sponsor. The same signed transaction, sent three ways:
        </p>
        <div className="lanes" key={run}>
          <div className="lane blocked">
            <div className="who">
              Public mempool<small>canonical rules</small>
            </div>
            <div className="channel">
              <div className="ship">
                <Boat width={58} />
              </div>
              <div className="boom" />
              <div className="why">✕ {strip(rescue.canonical.message)}</div>
            </div>
          </div>
          <div className="lane blocked">
            <div className="who">
              Alt mempool<small>paymaster not staked</small>
            </div>
            <div className="channel">
              <div className="ship">
                <Boat width={58} />
              </div>
              <div className="boom" />
              <div className="why">✕ {strip(rescue.altUnstaked.message).replace(/0x0+(\d+)$/, "0x…$1")}</div>
            </div>
          </div>
          <div className="lane passed">
            <div className="who">
              Alt mempool<small>paymaster staked · 0.012 ETH</small>
            </div>
            <div className="channel">
              <div className="ship">
                <Boat width={58} />
              </div>
              <div className="boom" />
              <div className="why">✓ included in block {parseInt(rescue.receipt.blockNumber, 16).toLocaleString()}</div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <a className="mono" href={explorerTx(rescue.altStaked.hash)} target="_blank" rel="noreferrer">
              {short(rescue.altStaked.hash, 10)} on the explorer ↗
            </a>
            <div className="examples" style={{ marginTop: 0 }}>
              <button onClick={() => setRun((r) => r + 1)}>↻ sail again</button>
            </div>
          </div>
        </div>
      </section>

      <section className="section grid cols-2">
        <div className="paper-card">
          <h3>Cargo moved</h3>
          <table className="manifest">
            <tbody>
              <tr>
                <td className="b">Exposed wallet</td>
                <td className="m">
                  {rescue.before.eoaEth} ETH · {rescue.before.eoaUsdc} → {rescue.after.eoaUsdc} mUSDC
                </td>
              </tr>
              <tr>
                <td className="b">Post-quantum account</td>
                <td className="m">
                  {rescue.before.destUsdc} → <b style={{ color: "var(--green)" }}>{rescue.after.destUsdc} mUSDC</b>
                </td>
              </tr>
              <tr>
                <td className="b">Paymaster</td>
                <td className="m">repaid {rescue.after.paymasterUsdc} mUSDC</td>
              </tr>
            </tbody>
          </table>
          <p className="note">Frame gas: {rescueFrames.map((g: number) => g.toLocaleString()).join(" · ")}. The sponsor's check is the 2nd frame.</p>
        </div>
        <div className="paper-card">
          <h3>The sponsor can't be cheated</h3>
          <table className="manifest">
            <tbody>
              {guards.cases.map((c: { name: string; paymasterApproved: boolean }) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td style={{ textAlign: "right" }}>{c.paymasterApproved ? <Pill status="ok">pays</Pill> : <Pill status="exposed">refuses</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">Dry-runs on the live devnet, each changing one thing.</p>
        </div>
      </section>
      <p className="note section">
        Design, gas and trade-offs: <a href={`${REPO}/blob/main/docs/pq-account.md`}>pq-account.md</a> · <a href={`${REPO}/blob/main/docs/rescue-paymaster.md`}>rescue-paymaster.md</a>
      </p>
    </>
  );
}
