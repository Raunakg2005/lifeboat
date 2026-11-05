# Lifeboat: business model

**Lifeboat is the readiness and evacuation layer for Ethereum's move to post-quantum keys.** We sell the map (who controls what, and whose keys are already public) and the way out (rescue rails, name handovers, safe one-time signing). The data and the standards stay open.

No quantum computer can do this today. Lifeboat helps people prepare before one can.

## Lean canvas

| | |
|---|---|
| **Problem** | 1. Every signature puts a public key on-chain, and a future quantum computer can turn a public key into the private key. 2. Today's checkers only ask "has this address sent a transaction?", so they miss most multisig signers. 3. Getting out is hard: wallets with no ETH can't pay gas, a transferred name leaves its old controllers behind, and one-time keys fail if they ever sign twice. |
| **Customer segments** | Beachhead: **protocols with upgrade keys** (rollups, bridges, security councils, DAO treasuries). Next: custodians and funds; wallets and the Safe ecosystem; owners of valuable ENS names. Individuals use it free. |
| **Unique value proposition** | **A takeover map, and a way out.** Evidence instead of a score: every verdict links the recovered public key and the transaction it came from. |
| **Solution** | Discover (hidden exposure via signatures), Scan and Helm check (full control graph of addresses, Safes and ENSv2 names), Escape (PQ account, staked rescue paymaster, verified name handover), Sign safely (hardware one-way counter), Harbour (public registry and leaf ledger). |
| **Channels** | Responsible disclosure to public infrastructure, free tools, a public API, Safe and wallet integrations, security-audit firms, ENS and Arkiv ecosystems, open standards. |
| **Revenue streams** | Readiness assessments (fixed fee), continuous monitoring (subscription), paid API tiers, migration services, a small fee on sponsored rescues. |
| **Cost structure** | A small engineering team, RPC and log-indexing providers, Arkiv and Swarm storage, paymaster stake (locked capital, returned on exit), hardware prototypes, legal review of the disclosure policy. |
| **Key metrics** | Value whose control path is mapped and monitored; organisations with a migration plan; names handed over; rescues completed; one-time-key reuse alerts on our signers (target: zero). |
| **Unfair advantage** | The hidden-exposure method plus a block-stamped evidence trail, the only end-to-end path from finding to escape, and open standards that others build on. |

## Why now

- **The deadlines are written down.** NIST IR 8547 deprecates quantum-vulnerable signatures such as ECDSA after 2030 and disallows them after 2035 ([CSA note on the final IR 8547, Oct 2026](https://labs.cloudsecurityalliance.org/research/csa-research-note-nist-ir8547-pqc-transition-20261030-csa-st/)). Institutions plan to these dates.
- **The attack got cheaper on paper.** Google Quantum AI's March 2026 paper estimates that breaking a secp256k1 key needs at most about 1,200 logical qubits ([summary](https://postquantum.com/security-pqc/google-quantum-bitcoin-ecdlp/)). That's still far beyond today's machines.
- **Regulators ask for prioritisation by risk.** Europol's Quantum Safe Financial Forum published a risk-based framework for ordering PQC migration work in January 2026 ([eucrim](https://eucrim.eu/news/europol-report-outlines-transition-to-post-quantum-cryptography-for-financial-institutions/)). Ordering by exposure is what Lifeboat does.
- **Ethereum is moving.** The Ethereum Foundation's post-quantum roadmap is aiming for 2028–2029 (preliminary dates, [summary](https://everstake.one/resources/blog/post-quantum-signatures-ethereum-evm)), and EIP-8141 frame transactions let an account verify any signature scheme natively.
- **Investors already fund the category.** Project Eleven raised a $20M Series A in January 2026 for post-quantum migration tools, Bitcoin-first ([The Block](https://www.theblock.co/news/deals/2026-01-14-project-eleven-series-a-funding-crypto-quantum-threats-385583)).
- **Migration is slow for organisations.** A DAO or security council needs governance votes, timelocks and new signers. The ones that start first finish first.

## Who pays, and what they get

| Segment | Their pain | What they buy | Who signs off |
|---|---|---|---|
| **Protocols with upgrade keys** (rollups, bridges, security councils, DAO treasuries) | Their upgrade path is controlled by keys whose public keys are already on-chain, and they have no inventory or plan | A takeover map of every admin key and Safe (nested Safes included), a migration plan, monitoring with alerts, a public readiness attestation | Security lead, foundation, DAO security budget |
| **Custodians, exchanges, funds** | Compliance needs an inventory of quantum-vulnerable keys and a dated plan | Exposure reports for their address fleet, signed attestations, API access | CISO, compliance |
| **Wallets and Safe ecosystem apps** | Users will ask "am I exposed?", and wallets need a way out to offer | API and SDK: warn before sending to an exposed address or name, one-click rescue through the paymaster, ENS handover flow | Product lead (revenue share or API plan) |
| **Owners of valuable ENS names** (protocols, brands) | A name moved to a safe wallet can still be steered through its resolver, delegates or operators | Helm check, registry-verified handover, `pq.*` records | Name owner |
| **Individuals** | "Is my wallet exposed, and how do I get out?" | Free scan and Helm check. A rescue costs gas plus a small fee, paid in the token they hold | — |

**Partners, not competitors:** post-quantum wallet teams (Kohaku, ZKNox, Tectonic, leanSPHINCS when it ships) are the destinations. Lifeboat brings users to them. Audit firms can resell assessments. ENS, Arkiv and Swarm are the rails.

## Products and pricing (starting hypotheses, to test with the first design partners)

| Product | What's in it | Price |
|---|---|---|
| **Free** | Scan any address on 6 chains, Helm check any ENSv2 name, Discover, the public registry | Free, forever |
| **API** | Exposure and control-graph endpoints, block-stamped, with the proof attached | Free up to 1,000 checks a month; **$199/month** for 100k; enterprise on request |
| **Monitor** | Watches an organisation's Safes, admin keys and names. Alerts when a new signature exposes a key or a threshold becomes reachable. Monthly readiness attestation on Arkiv | **$499/month** (up to 10 Safes or names); **$2,000/month** (unlimited, with a named engineer during migration) |
| **Readiness assessment** | Full takeover map of a protocol's control paths, a ranked migration plan, and a review call. Most of the work is automated by our scanner | **$15k–$40k** per protocol, fixed fee |
| **Migration service** | We run the handovers with the team: PQ co-signers on Safes, name handovers, rescue sweeps, each verified on-chain and recorded on Arkiv | Per project, quoted with the assessment |
| **Rescue paymaster** | Pays gas for wallets that hold tokens but no ETH, repaid in the token within the same transaction | Gas at cost plus a small flat fee (for example $1). The fee covers operations and the capital locked as stake |
| **Signer reference design** | Open firmware for a stateful PQ signer with a one-way counter | Free and open. Revenue only through partnerships with hardware makers |

**Why these prices:** an assessment is priced like a small security review. Our scanner does the heavy lifting, so one engineer can deliver it in about a week. Monitoring is priced per organisation, the way security teams buy alerting. The rescue fee stays small on purpose: it's a public good that has to cover its own costs.

## What stays open, and why it makes money

**Open:** all code (MIT), the Arkiv registry and leaf ledger, the `pq.*` ENS records (draft ENSIP), the signer firmware.
- A security tool has to be verifiable to be trusted. Anyone can re-run our findings.
- Open data and standards spread further than a closed product, and every integration points back to us.

**Paid:** the work around the open core. That means monitoring, assessments, migration, SLAs and integration support. It's the model of an open-source security company.

## Illustrative first year (a target, not a forecast)

| Line | Assumption | Amount |
|---|---|---|
| Readiness assessments | 8 protocols × $20k | $160k |
| Monitor | 15 organisations × $1,000/month average | $180k a year |
| API | 20 teams × $250/month average | $60k a year |
| Rescue fees | Small before Q-Day; grows only when people need it | ~$0 |
| **Total** | | **~$400k** |

**Costs:** a 3–4 person team, RPC and log providers, Arkiv and Swarm storage, and paymaster stake (locked capital, not spent). Grants fund the open parts: the registry, the ENSIP, the firmware.

**Unit economics:** an assessment is about one engineer-week on top of automated scans, so the gross margin is high. Monitoring costs RPC calls and a few Arkiv writes a month per organisation.

## Go-to-market

1. **Now to Dec 2026: earn trust.**
   - Brief the security councils privately with their takeover maps before any public post.
   - Publish the method and the open data.
   - Post the `pq.*` draft ENSIP on the ENS forum.
   - Ship the Dabao signer for Crossbar (15 Dec).
   - Apply for ecosystem grants (EF Ecosystem Support Program, ENS, Arkiv).
2. **First half of 2027: design partners.**
   - Give 3–5 rollups, bridges or DAOs a free takeover map, then convert them to Monitor and an assessment.
   - Launch the public API beta.
   - Integrate with one wallet, so the warning shows at the moment of sending.
3. **When frame transactions reach mainnet: open the way out.**
   - The rescue paymaster goes live on mainnet with real stake.
   - Migration services start.
   - Parallel evacuation lanes (see the used-leaf bitmap note in [pq-account.md](pq-account.md)).
4. **After that: institutions and more chains.**
   - Attestation reports for custodians and funds.
   - More EVM chains.
   - leanSPHINCS as a destination.

**Channels:**
- Responsible-disclosure briefings (each one is also a sales conversation)
- The free tools and the public registry
- Security-audit firms reselling assessments
- The Safe app ecosystem
- Wallet integrations
- ENS and Arkiv community programmes

## Competition and positioning

From our scan of the market before the event. Check it again before pitching.

| Who | What they do | How Lifeboat is different |
|---|---|---|
| Project Eleven | Bitcoin-first migration tools (Yellowpages), research, a Q-Day prize | Ethereum control graph: Safes, nested councils, ENSv2 names, admin keys, plus the escape rails |
| BitGo Quantum Risk Score | Institutional, Bitcoin | Evidence per verdict, open data, Ethereum-native |
| Single-address checkers (Quantus, QuantumTrace, StablePQC) | A score per address, based on "has it sent a transaction?" | We recover keys from signatures. Optimism's council goes from 4 to 13 of 13 public keys; Base's nested council from 0 to 11 |
| PQ wallets (Kohaku, ZKNox, Tectonic) | New accounts to move into | They're the destination; we're the evacuation. Scan, Helm check, registry and rescue work with any PQ account |
| Audit firms | Smart-contract security reviews | Likely channel partners: our scanner powers their PQ readiness offering |

**Our position:** "Wallet teams are building the new houses. Lifeboat finds everyone still in the old one and gets them across."

## Moat (said honestly)

The method itself can be copied: it's open source. What's hard to copy:
1. **The evidence trail.** Block-stamped findings on Arkiv and Swarm, built up over time.
2. **The full path.** Finding, mapping, escaping and keeping the name, all in one place, each step verified on-chain.
3. **Integrations.** Once Lifeboat is in wallets, Safe apps and audit workflows, switching costs are real.
4. **Standards.** The `pq.*` records and the leaf ledger format, if others adopt them.
5. **Trust.** Responsible disclosure, aggregates for public statistics, opt-in for individuals.

## Metrics we'd report

- **North star:** value whose control path is mapped and monitored, measured as ETH and TVL under Monitor.
- Organisations with a migration plan, and how far along each one is.
- Names handed over, rescues completed, keys moved to PQ accounts (each recorded on Arkiv).
- Reuse alerts for one-time keys on our own signers (target: zero).
- API calls and integrations shipped.

## Risks and how we handle them

| Risk | What we do about it |
|---|---|
| Q-Day stays far away, so demand is soft | Compliance dates drive budgets regardless (NIST 2030/2035). The control-graph map is useful today: it shows who can upgrade what |
| Ethereum ships an emergency fork for Q-Day | Any emergency plan still needs an inventory of exposed keys and destination accounts. Lifeboat provides both and plugs in |
| A public exposure list reads as a target list | Public statistics are aggregates. Individuals appear only when they opt in. We name public infrastructure only, and disclose privately first |
| One-time keys get reused by mistake | Hardware counter saved before signing, on-chain leaf floor, public leaf ledger. Everything except the account's own verifier is scheme-agnostic, so a stateless scheme like leanSPHINCS can replace WOTS+C |
| Frame transactions take time to reach mainnet | The Sepolia PQ wallet already works on today's chains through any relayer. The scanner and Helm check don't depend on EIP-8141 |
| The rescue sponsor gets drained | Cost cap, registry check, and repayment in the very next frame; five attack variants refused on the live devnet |
| Better-funded competitors | Partner with wallet teams and audit firms; stay focused on Ethereum's control graph |
| Hardware is expensive to build and sell | Keep the signer an open reference design and partner with hardware makers |

## Funding plan

1. Grants for the open parts (registry, ENSIP, firmware) through the Ethereum ecosystem's grant programmes.
2. Revenue from design partners: assessments, then Monitor.
3. A pre-seed round only after three paying design partners, to fund the mainnet rescue paymaster's stake and the wallet integrations.

## The business pitch in 30 seconds

"Every Ethereum signature leaves a public key on-chain, and a future quantum computer can turn it into a private key. Lifeboat finds which treasuries, councils and names are controlled by keys that are already public, and gets them out. The tools and data are free and open. Protocols pay for monitoring, a readiness assessment and help migrating. We start with the security councils and bridges, because their upgrade keys guard the most value and they already have security budgets."
