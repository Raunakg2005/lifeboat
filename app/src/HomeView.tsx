import snapshot from "../../evidence/discovery/councils.json";
import survey from "../../evidence/ens/survey.json";
import guardEv from "../../evidence/guard/quantum-guard.json";
import { useState } from "react";
import { REPO, explorerTx, findExposureRecords, sepoliaTx, short, swarmUrl, type EvidenceRecord } from "./lib";
import { Boat, LuggageTag } from "./ui";
import EvidenceDrawer, { EvidenceButton } from "./EvidenceDrawer";
import { quantumHardwareRuns } from "./QuantumPanel";

type Tab = "home" | "check" | "discover" | "escape" | "harbour";

type Council = { label: string; block: string; threshold: number; owners: { how: string; nested?: { threshold: number; owners: number; exposedByNonce: number; exposedTotal: number } }[]; exposedByNonce: number; exposedTotal: number };
const councils = snapshot.results as unknown as Council[];
const optimism = councils.find((c) => c.label.startsWith("Optimism"));
const baseNested = councils.flatMap((c) => c.owners.map((o) => o.nested)).find((n) => n && n.threshold === 8);
const scanBlock = optimism ? Number(optimism.block).toLocaleString("en-US") : "";
const COUNCIL_SWARM = "cf5693936d6583e069e069a9a1095dcac6333685994bc965423589fcd24b05de";

const ROUTE: { n: number; title: string; line: string; proof: string; tab: Tab; cta: string }[] = [
  { n: 1, title: "Detect", line: "Recover public keys from multisig signatures, not just from sent transactions.", proof: "Optimism council: 4 → 13 of 13", tab: "discover", cta: "Discover" },
  { n: 2, title: "Map", line: "Every key that can steer an ENSv2 name, across five control paths, proven complete.", proof: `${survey.verdicts.hijackable.toLocaleString("en-US")} of ${survey.checked.toLocaleString("en-US")} real names exposed`, tab: "check", cta: "Helm check" },
  { n: 3, title: "Escape", line: "A post-quantum account that checks a hash-based signature in the transaction itself.", proof: "52,367 gas · block 2,159", tab: "escape", cta: "Escape" },
  { n: 4, title: "Rescue", line: "A staked sponsor pays gas for wallets with tokens but no ETH, and is repaid in USDC.", proof: "❌ ❌ ✅ · block 2,174", tab: "escape", cta: "The rescue" },
  { n: 5, title: "Sign safely", line: "A device that saves its counter before signing, so a one-time key is used once.", proof: "ESP32-signed · block 406,887", tab: "escape", cta: "Hardware" },
  { n: 6, title: "Publish", line: "Every finding re-checked on-chain, then published to Arkiv, with full evidence on Swarm.", proof: "leaf ledger: 'signed twice' caught", tab: "harbour", cta: "Harbour" },
];

// `swarm`: the row is a Swarm file; `via` finds the Arkiv records that name it (the council scan is written with via = safe-signature).
const PROOF: { what: string; net: string; at: string; href: string; swarm?: { ref: string; via: string } }[] = [
  { what: "First post-quantum frame transaction (WOTS+C, no ECDSA)", net: "EIP-8141 devnet", at: "block 2,159", href: explorerTx("0x115659a935d1fe86a81a445f05d2c20ced792bec617ba43ff0fab4ce07345784") },
  { what: "Sponsored rescue, admitted only by the staked alt mempool", net: "EIP-8141 devnet", at: "block 2,174", href: explorerTx("0x26462c908a8e4002f73430dabf9844bb51fde79bf6d839210f58f57d394669f3") },
  { what: "Forgery from 12 reused fee bumps, accepted by VERIFY", net: "EIP-8141 devnet", at: "block 2,191", href: explorerTx("0xa70bda46414caaadb53430ae8e26ed27fc2f4f8a2c2a0e3be44b2f33988929cb") },
  { what: "Transaction signed on the ESP32 after a button press", net: "EIP-8141 devnet", at: "block 406,887 (before the 6 Nov devnet reset)", href: explorerTx("0x69c1eaec36a29185a599ebead5a0662a7198683c352ba98e88dda3daeaf39213") },
  { what: "ENS name handed over to a post-quantum wallet", net: "Sepolia ENSv2", at: short("0x2509d99b9997dc90a35a1c5ffef23f697797797ea22ace5bba04175479be206a", 6), href: sepoliaTx("0x2509d99b9997dc90a35a1c5ffef23f697797797ea22ace5bba04175479be206a") },
  { what: "Council deep scan, every signer, stored on Swarm", net: "Swarm testnet", at: short(COUNCIL_SWARM, 6), href: swarmUrl(COUNCIL_SWARM), swarm: { ref: COUNCIL_SWARM, via: "safe-signature" } },
  ...guardEv.steps
    .filter((s) => s.what.startsWith("attack") || s.what.startsWith("pay 0.001 ETH to the treasury"))
    .map((s) => ({
      what: s.what.startsWith("attack") ? "Quantum Guard refused a Safe payment signed by the owners only" : "Quantum Guard let the co-signed payment through",
      net: "Sepolia · Safe 1.4.1",
      at: `block ${Number(s.block).toLocaleString("en-US")}`,
      href: sepoliaTx(s.hash),
    })),
  ...quantumHardwareRuns().map((q) => ({
    what: `Shor's algorithm recovered a ${q.bits}-bit toy private key from its public key`,
    net: `IBM ${q.backend}`,
    at: `job ${q.jobId.slice(0, 8)}…`,
    href: `${REPO}/blob/main/docs/quantum-demo.md`,
  })),
];

const PARTNERS = [
  { who: "Ethereum Foundation", what: "EIP-8141 frame transactions · ERC-8421 alt mempool", lines: ["WOTS+C verified in the VERIFY frame, in Yul", "Staked rescue paymaster: public ❌, unstaked ❌, staked ✅"], doc: "docs/pq-account.md" },
  { who: "ENS", what: "ENSv2 on Sepolia", lines: ["Helm check for any name: 5 paths, role lists proven complete", "Registry-verified handover, plus pq.* records"], doc: "docs/helm-check.md" },
  { who: "Arkiv + Swarm", what: "Rabdi testnet · Bee light node", lines: ["Public Q-Day registry with expiring readings", "A one-time-key ledger anyone can write to"], doc: "arkiv/schema.md" },
  { who: "Hardware", what: "ESP32 today · Dabao next", lines: ["Key generated on the device, Approve on the device", "Counter saved before every signature"], doc: "docs/hardware.md" },
];

const WHO: { tone: "bad" | "good" | "neutral" | "unknown"; verdict: string; id: string; meta: string; body: string }[] = [
  { tone: "bad", verdict: "Councils", id: "Protocols with upgrade keys", meta: "rollups · bridges · DAO treasuries", body: "A takeover map of every admin key and Safe, a ranked migration plan, and alerts when a new signature exposes a key." },
  { tone: "neutral", verdict: "Funds", id: "Custodians, exchanges, funds", meta: "compliance · NIST 2030 / 2035", body: "An exposure inventory of the address fleet, with block-stamped evidence for every verdict." },
  { tone: "unknown", verdict: "Wallets", id: "Wallets and Safe apps", meta: "API · SDK", body: "Warn before sending to an exposed address or name, and offer the rescue and the name handover in one click." },
  { tone: "good", verdict: "Everyone", id: "Name owners and individuals", meta: "free, forever", body: "Scan any wallet, Helm-check any ENSv2 name, read the public registry. A rescue costs gas plus a small fee." },
];

export default function HomeView({ onGo }: { onGo: (t: Tab) => void }) {
  const [ev, setEv] = useState<{ ref: string; title: string; records: EvidenceRecord[] | null } | null>(null);
  const openSwarm = (what: string, s: { ref: string; via: string }) => {
    setEv({ ref: s.ref, title: what, records: null });
    findExposureRecords(s.ref, s.via)
      .then((records) => setEv((e) => (e && e.ref === s.ref ? { ...e, records } : e)))
      .catch(() => setEv((e) => (e && e.ref === s.ref ? { ...e, records: [] } : e)));
  };
  return (
    <>
      {ev && <EvidenceDrawer swarmRef={ev.ref} records={ev.records} title={ev.title} onClose={() => setEv(null)} />}
      <section className="landing-hero">
        <div>
          <div className="label">Q-Day readiness for Ethereum · built from scratch at ETHGlobal Mumbai 2026</div>
          <h1>
            Get off
            <br />
            before Q-Day<span className="o">.</span>
          </h1>
          <p className="lede">
            A future quantum computer can take over any wallet whose public key is on-chain, and <b>every signature puts it there</b>, not just sending a transaction. Lifeboat shows who could take over
            what, and gives each one a way out.
          </p>
          <div className="cta-row">
            <button className="cta" onClick={() => onGo("check")}>
              Scan a name or wallet →
            </button>
            <button className="cta ghost" onClick={() => onGo("discover")}>
              See the hidden exposure
            </button>
          </div>
          <div className="warning">No quantum computer can do this today. These are readiness findings from public on-chain data.</div>
        </div>

        <aside className="ticket" aria-label="Findings">
          <div className="ticket-head">
            <span className="stencil">Manifest</span>
            <span className="label">Ethereum mainnet · block {scanBlock}</span>
          </div>
          <div className="ticket-row">
            <div className="k">Optimism Security Council</div>
            <div className="v">
              {optimism?.exposedByNonce ?? 4} <span className="arrow">→</span> <b>{optimism?.exposedTotal ?? 13}</b>
              <small> of {optimism?.owners.length ?? 13} keys public</small>
            </div>
          </div>
          <div className="ticket-row">
            <div className="k">Base's nested 8-of-11 council</div>
            <div className="v">
              {baseNested?.exposedByNonce ?? 0} <span className="arrow">→</span> <b>{baseNested?.exposedTotal ?? 11}</b>
              <small> of {baseNested?.owners ?? 11} keys public</small>
            </div>
          </div>
          <div className="ticket-row">
            <div className="k">Real ENSv2 names, one per owner (Sepolia)</div>
            <div className="v">
              <b>{survey.verdicts.hijackable.toLocaleString("en-US")}</b>
              <small> of {survey.checked.toLocaleString("en-US")} can be steered on Q-Day</small>
            </div>
          </div>
          <div className="ticket-row">
            <div className="k">A one-time key re-signed 12 times</div>
            <div className="v">
              <b>0.2 s</b>
              <small> to forge a valid signature</small>
            </div>
          </div>
          <div className="ticket-foot">
            <span className="label">nonce count → counting signatures</span>
            <span className="rubber bad">Readiness data</span>
          </div>
        </aside>
      </section>

      <section className="section">
        <div className="label">The problem</div>
        <h2>
          Three things <span className="o">to know</span>
        </h2>
        <div className="grid notices">
          <div className="notice">
            <span className="num">1</span>
            <h3>Every signature shows the key</h3>
            <p>Your address hides your public key until you sign. One signature reveals it to anyone, forever: a payment, a multisig approval, a vote.</p>
          </div>
          <div className="notice">
            <span className="num">2</span>
            <h3>Checkers count transactions</h3>
            <p>Multisig signers sign without sending. Counting their signatures, Optimism's Security Council goes from 4 to all 13 of its keys public.</p>
          </div>
          <div className="notice">
            <span className="num">3</span>
            <h3>Getting out is hard</h3>
            <p>Many wallets hold tokens but no ETH for gas. A transferred name keeps its old controllers. A one-time key fails the moment it signs twice.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="label">The route out</div>
        <h2>
          Six stops, <span className="o">all live</span>
        </h2>
        <ol className="route">
          {ROUTE.map((s) => (
            <li key={s.n} className="stop">
              <span className="buoy">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.line}</p>
              <span className="chip">{s.proof}</span>
              <button className="open" onClick={() => onGo(s.tab)}>
                {s.cta} →
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="section">
        <div className="board">
          <div className="board-head">
            <h3>Proof on-chain</h3>
            <span className="label">every claim links its transaction</span>
          </div>
          <div className="table-wrap">
            <table className="manifest">
              <thead>
                <tr>
                  <th>What happened</th>
                  <th>Network</th>
                  <th>Where</th>
                </tr>
              </thead>
              <tbody>
                {PROOF.map((p) => (
                  <tr key={p.href}>
                    <td className="b">{p.what}</td>
                    <td className="m">{p.net}</td>
                    <td className="m">
                      <a href={p.href} target="_blank" rel="noreferrer">
                        {p.at} ↗
                      </a>
                      {p.swarm && (
                        <>
                          {" · "}
                          <EvidenceButton onOpen={() => openSwarm(p.what, p.swarm!)} />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="label">Built on</div>
        <h2>
          Four partners, <span className="o">one way out</span>
        </h2>
        <div className="grid cols-4">
          {PARTNERS.map((p) => (
            <div key={p.who} className="paper-card partner">
              <h3>{p.who}</h3>
              <div className="label">{p.what}</div>
              <ul>
                {p.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <a href={`${REPO}/blob/main/${p.doc}`} target="_blank" rel="noreferrer">
                How it works ↗
              </a>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="label">Who it's for</div>
        <h2>
          Free to check, <span className="o">paid to protect</span>
        </h2>
        <p className="lead">The tools and the data are open. Protocols pay for monitoring, a readiness assessment and help migrating; wallets pay for the API.</p>
        <div className="grid who-grid">
          {WHO.map((w) => (
            <LuggageTag key={w.id} tone={w.tone} verdict={w.verdict} id={w.id} meta={w.meta}>
              <p className="desc">{w.body}</p>
            </LuggageTag>
          ))}
        </div>
        <div className="plans">
          <div>
            <b>Free</b>
            <span>scan · Helm check · registry</span>
          </div>
          <div>
            <b>API</b>
            <span>from $199 / month</span>
          </div>
          <div>
            <b>Monitor</b>
            <span>from $499 / month</span>
          </div>
          <div>
            <b>Assessment</b>
            <span>$15k–$40k per protocol</span>
          </div>
        </div>
        <p className="note">
          Pilot pricing, to test with the first design partners. The full plan:{" "}
          <a href={`${REPO}/blob/main/docs/business-model.md`} target="_blank" rel="noreferrer">
            business model
          </a>
          .
        </p>
      </section>

      <section className="section">
        <div className="grid cols-4 rules">
          <div className="rule-card">
            <h3>Public infrastructure only</h3>
            <p>We name councils, bridges and DAOs. People are counted, never named, and signer addresses are truncated.</p>
          </div>
          <div className="rule-card">
            <h3>Owners hear first</h3>
            <p>Findings about someone else's system go to them privately before anything is published.</p>
          </div>
          <div className="rule-card">
            <h3>Block-stamped</h3>
            <p>Every number says which block it's true for, and every verdict links its proof.</p>
          </div>
          <div className="rule-card">
            <h3>Open source</h3>
            <p>MIT licensed. Anyone can re-run every scan and every check from public data.</p>
          </div>
        </div>
      </section>

      <section className="final">
        <div className="final-boat">
          <Boat width={120} />
        </div>
        <div>
          <h2>
            Board the <span className="o">lifeboat.</span>
          </h2>
          <p>Check a wallet or an ENSv2 name in a few seconds. Read-only: Lifeboat never asks for a key or a signature.</p>
          <div className="cta-row">
            <button className="cta" onClick={() => onGo("check")}>
              Start a scan →
            </button>
            <a className="cta ghost light" href={`${REPO}/blob/main/docs/explainer.md`} target="_blank" rel="noreferrer">
              Lifeboat, explained
            </a>
            <a className="cta ghost light" href={REPO} target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
