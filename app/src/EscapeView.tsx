import first from "../../evidence/ef/frame-demo-leaf1.json";
import rescue from "../../evidence/ef/rescue.json";
import guards from "../../evidence/ef/paymaster-guards.json";
import { REPO, explorerTx, short } from "./lib";

const verifyGas = parseInt(first.simulation.frames[0]!.gasUsed, 16);
const rescueFrames = rescue.simulation.frames.map((f: { gasUsed: string }) => parseInt(f.gasUsed, 16));
const strip = (m: string) => m.replace(/^[a-zA-Z_]+ @ [^:]+: /, "");

export default function EscapeView() {
  return (
    <>
      <section>
        <h2>A post-quantum account that works today</h2>
        <p className="sub">
          EIP-8141 frame transactions let an account verify any signature in a VERIFY frame. Ours verifies a WOTS+C hash-based signature (no ECDSA anywhere), written in Yul.
        </p>
        <div className="grid three">
          <div className="card stat">
            <span className="v">{verifyGas.toLocaleString()}</span>
            <span className="k">gas for the whole VERIFY frame (cap: 100,000)</span>
          </div>
          <div className="card stat">
            <span className="v">44,870</span>
            <span className="k">gas for the WOTS+C check itself, the same for every signature</span>
          </div>
          <div className="card stat">
            <span className="v">400</span>
            <span className="k">hashes per check: the digest's digits always sum to 560, so no checksum chains</span>
          </div>
          <div className="card stat">
            <span className="v">256</span>
            <span className="k">one-time keys per account; a fresh one for every signing attempt, burned on-chain once used</span>
          </div>
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <h3>First transaction, through the ERC-8421 alt mempool</h3>
          <p>
            <a href={explorerTx(first.txHash)} target="_blank" rel="noreferrer" className="mono">
              {first.txHash}
            </a>
          </p>
          <p className="note">
            Chain 1337 · block {parseInt(first.receipt.blockNumber, 16).toLocaleString()} · status success · witness {first.witnessBytes.toLocaleString()} bytes · leaf {first.leaf} (leaf 0 was spent by a dry-run, so it's never used again)
          </p>
        </div>
      </section>

      <section>
        <h2>The rescue: a wallet with tokens but no ETH escapes anyway</h2>
        <p className="sub">
          A staked paymaster pays the gas and is repaid in USDC inside the same transaction. It must read shared state to decide (its registry of exposed accounts, and the token balance through an
          upgradeable proxy). That's exactly what only the alt mempool allows, and only for a staked sponsor.
        </p>
        <div className="card matrix">
          <div className="row">
            <b>Public (canonical) mempool</b>
            <span className="badge exposed">rejected</span>
            <span className="quote">{strip(rescue.canonical.message)}</span>
          </div>
          <div className="row">
            <b>Alt mempool, paymaster not staked</b>
            <span className="badge exposed">rejected</span>
            <span className="quote">{strip(rescue.altUnstaked.message)}</span>
          </div>
          <div className="row">
            <b>Alt mempool, paymaster staked (0.012 ETH)</b>
            <span className="badge ok">included</span>
            <span>
              block {parseInt(rescue.receipt.blockNumber, 16).toLocaleString()} ·{" "}
              <a href={explorerTx(rescue.altStaked.hash)} target="_blank" rel="noreferrer" className="mono">
                {short(rescue.altStaked.hash, 10)}
              </a>
            </span>
          </div>
        </div>
        <div className="grid two" style={{ marginTop: 16 }}>
          <div className="card">
            <h3>Before → after</h3>
            <table>
              <tbody>
                <tr>
                  <td>Exposed wallet</td>
                  <td className="num">
                    {rescue.before.eoaEth} ETH, {rescue.before.eoaUsdc} mUSDC → {rescue.after.eoaUsdc} mUSDC
                  </td>
                </tr>
                <tr>
                  <td>Post-quantum account</td>
                  <td className="num">
                    {rescue.before.destUsdc} → {rescue.after.destUsdc} mUSDC
                  </td>
                </tr>
                <tr>
                  <td>Paymaster</td>
                  <td className="num">repaid {rescue.after.paymasterUsdc} mUSDC</td>
                </tr>
              </tbody>
            </table>
            <p className="note">Frame gas: {rescueFrames.map((g: number) => g.toLocaleString()).join(" · ")} (the sponsor's check is the 2nd)</p>
          </div>
          <div className="card">
            <h3>The sponsor can't be cheated</h3>
            <table>
              <tbody>
                {guards.cases.map((c: { name: string; paymasterApproved: boolean }) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td>{c.paymasterApproved ? <span className="badge ok">pays</span> : <span className="badge exposed">refuses</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">Dry-runs on the live devnet, each changing one thing.</p>
          </div>
        </div>
        <p className="note" style={{ marginTop: 12 }}>
          Design and numbers: <a href={`${REPO}/blob/main/docs/pq-account.md`}>pq-account.md</a> · <a href={`${REPO}/blob/main/docs/rescue-paymaster.md`}>rescue-paymaster.md</a>
        </p>
      </section>
    </>
  );
}
