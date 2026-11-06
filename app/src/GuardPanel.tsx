import ev from "../../evidence/guard/quantum-guard.json";
import { REPO, sepoliaAddr, sepoliaTx, short } from "./lib";
import { Rubber } from "./ui";

type Step = { what: string; hash: string; block: string; status: string; gasUsed: string };
const steps = (ev as { steps: Step[] }).steps;
const find = (prefix: string) => steps.find((s) => s.what.startsWith(prefix));
const attack = find("attack");
const cosigned = find("pay 0.001 ETH to the treasury");
const handler = find("Safe tx: setFallbackHandler");
const approve = find("PQ key approves");
const ok1271 = (v: string) => v === "0x1626ba7e";
// the same Safe against Uniswap's real Permit2 (scripts/src/guard-permit2.ts → evidence/guard/permit2.json)
const p2Files = import.meta.glob<{ default: { steps: Step[]; permitRevertOwnersOnly?: string; allowanceAfter?: { amount: string } } }>("../../evidence/guard/permit2.json", { eager: true });
const p2 = Object.values(p2Files)[0]?.default;
const p2Refused = p2?.steps.find((s) => s.what.startsWith("Permit2.permit") && s.status !== "success");
const p2Approve = p2?.steps.find((s) => s.what.startsWith("PQ key approves"));
const p2Accepted = p2?.steps.find((s) => s.what.startsWith("Permit2.permit") && s.status === "success");

function TxLink({ s }: { s?: Step }) {
  if (!s) return null;
  return (
    <a className="mono" href={sepoliaTx(s.hash)} target="_blank" rel="noreferrer">
      block {Number(s.block).toLocaleString("en-US")} ↗
    </a>
  );
}

/** Quantum Guard on a real Safe 1.4.1 (Sepolia): every number and link comes from evidence/guard/quantum-guard.json. */
export default function GuardPanel() {
  if (!attack || !cosigned) return null;
  return (
    <section className="section">
      <div className="label">Protect in place · a real Safe 1.4.1 on Sepolia</div>
      <h2>
        Quantum Guard. <span className="o">Keep the Safe, add a lock.</span>
      </h2>
      <p className="lead">
        A council can't just move its funds. Quantum Guard adds a post-quantum co-signer to the Safe it already has: every transaction needs the owners <b>and</b> a WOTS+C signature from a key a quantum
        computer can't forge. It also covers ERC-1271 (Permit2, CoW orders), the path a transaction guard alone never sees.
      </p>
      <div className="board">
        <div className="board-head">
          <h3>Same Safe, three tries</h3>
          <span className="label">
            Safe {short(ev.safe)} · guard {short(ev.guard)}
          </span>
        </div>
        <div className="qg-row">
          <div>
            <div className="qg-who">Owners' signatures only</div>
            <div className="note">what a quantum computer could forge: pay an attacker</div>
          </div>
          <Rubber good={false}>Refused</Rubber>
          <div className="qg-proof">
            <span className="mono">{ev.attackRevert}</span>
            <TxLink s={attack} />
          </div>
        </div>
        <div className="qg-row">
          <div>
            <div className="qg-who">Owners + post-quantum co-signature</div>
            <div className="note">the same kind of payment, to the treasury</div>
          </div>
          <Rubber good>Included</Rubber>
          <div className="qg-proof">
            <span className="mono">{Number(cosigned.gasUsed).toLocaleString("en-US")} gas</span>
            <TxLink s={cosigned} />
          </div>
        </div>
        <div className="qg-row">
          <div>
            <div className="qg-who">An ERC-1271 signature from the owners</div>
            <div className="note">a Permit2 permit signed "by the Safe"</div>
          </div>
          <div className="qg-chips">
            <span className={`pill ${ok1271(ev.erc1271Before) ? "exposed" : "pq"}`}>before: {ok1271(ev.erc1271Before) ? "valid" : "refused"}</span>
            <span className={`pill ${ok1271(ev.erc1271AfterWithoutPQ) ? "exposed" : "pq"}`}>with the guard: {ok1271(ev.erc1271AfterWithoutPQ) ? "valid" : "refused"}</span>
            <span className={`pill ${ok1271(ev.erc1271AfterWithPQ) ? "pq" : "exposed"}`}>+ PQ approval: {ok1271(ev.erc1271AfterWithPQ) ? "valid" : "refused"}</span>
          </div>
          <div className="qg-proof">
            <TxLink s={approve} />
          </div>
        </div>
        {p2Refused && p2Accepted && (
          <div className="qg-row">
            <div>
              <div className="qg-who">Uniswap's Permit2, for real</div>
              <div className="note">
                a 1 USDC permit from the Safe, checked by Permit2 itself{p2.permitRevertOwnersOnly ? ` · refusal: ${p2.permitRevertOwnersOnly}` : ""}
              </div>
            </div>
            <div className="qg-chips">
              <span className="pill pq">owners only: refused</span>
              <span className="pill pq">+ PQ approval: accepted</span>
            </div>
            <div className="qg-proof">
              <TxLink s={p2Refused} /> <TxLink s={p2Approve} /> <TxLink s={p2Accepted} />
            </div>
          </div>
        )}
        <div className="board-note">
          The guard was installed with the owners' signatures, then made the Safe's signature handler in its first co-signed transaction (<TxLink s={handler} />). Each one-time leaf is spent on-chain
          before the signature is checked: {ev.leavesUsed} of 256 used. Credit: the co-signer guard pattern comes from Safe Research. ·{" "}
          <a href={sepoliaAddr(ev.guard)} target="_blank" rel="noreferrer">
            guard on Etherscan
          </a>{" "}
          ·{" "}
          <a href={`${REPO}/blob/main/docs/quantum-guard.md`} target="_blank" rel="noreferrer">
            how it works
          </a>
        </div>
      </div>
    </section>
  );
}
