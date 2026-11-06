# Lifeboat: the pitch

No quantum computer can do this today. Everything below is a readiness finding from public on-chain data, and every number comes from a file in `evidence/`.

## One line
**Lifeboat shows who could take over which wallets, Safes and ENS names on Q-Day, and moves them to post-quantum keys today, with the key on a device you hold.**

## 30 seconds (booth, elevator)
> Every signature you make on Ethereum puts your public key on-chain. A future quantum computer could turn that public key into your private key.
> On a tiny test key, that already works: we ran it on a real IBM quantum computer, and it returned the private key.
> Lifeboat finds what's exposed. That includes keys that never sent a transaction but signed for a multisig: 13 of 13 on Optimism's Security Council.
> Then it gets you out: a post-quantum account on EIP-8141, a guard for Safes you already have, and a safe handover for ENS names.
> Your new key lives on a small device. It shows every request in plain words and only signs after you press its button.

## 2 minutes (judges)
1. **The problem, in one fact.** Your public key goes on-chain the moment you sign anything. Multisig signers publish theirs every time they sign. Optimism's Security Council has **13 of 13** signer keys public once you count signatures, not 4. Base's nested council goes from 0 to 11. And the attack is real at toy scale: on IBM's **ibm_fez**, Shor's algorithm returned our 2-bit test key from its public key (69% of the votes, 25% by chance).
2. **Names too.** Across 1,011 real ENSv2 names on Sepolia (one per owner), **902 can be steered on Q-Day, 863 of them through their resolver.** That second path is the trap: you can move the name and still leave the resolver in the old key's hands.
3. **Get out, three ways:**
   - **Escape:** a WOTS+C post-quantum account checked inside an EIP-8141 frame transaction, **52,367 gas**. A wallet with tokens but no ETH escapes too: a staked paymaster pays the gas and is repaid in USDC in the same transaction. Only the alternative mempool admits that, and we show all three answers live.
   - **Protect in place:** Quantum Guard adds a post-quantum co-signer to an existing Safe. A payment signed only by the owners is refused on-chain.
   - **Hand over a name:** the registry itself verifies the handover. Our test name `lifeboathw.eth` now belongs to a wallet whose key exists only on an ESP32.
4. **The device.** One-time keys must stay one-time: we forged a wallet that re-signed 12 fee bumps in **0.2 s**. So our signer keeps the counter on the device and saves it before every signature. It **never signs a bare hash**: it rebuilds what it signs from the request and shows it in words (amount, recipient, ENS name) before the button press. It's PIN-locked and signs for testnets only.
5. **Public and checkable.** Every finding is re-checked and published to Arkiv: signed, expiring, with a link to each record. The full evidence sits on Swarm, and the app re-hashes it in your browser to prove it matches.
6. **Business.** The tools and the data are free. Protocols pay for monitoring (councils, bridges, treasuries) and for help migrating.

## For each judge (one hook each)
| Judge | Say this first | Show |
|---|---|---|
| **EF: frame tx alt mempool** | "A hash-based signature checked natively in VERIFY, and a paymaster that only the staked alt mempool admits." | Escape tab: public mempool ❌, unstaked ❌, staked ✅ (block 2,174). The ESP32-signed frame tx (block 2,687) |
| **ENS: best use of ENSv2** | "Lifeboat changes who controls a name, through ENSv2's own roles, and the registry checks the handover. The new owner's key is on a device." | Protect → ENS name: `lifeboathw.eth` **PROTECTED**, owner = the device's post-quantum wallet. Check any name: 5 paths, proven complete |
| **Arkiv (+ Swarm)** | "A public Q-Day registry: readings that expire, an audit trail nobody can edit, and a one-time-key ledger anyone can write to." | Harbour: "signed twice" alert, readonly stamps from creation flags, **open evidence** → "Swarm file matches the Arkiv record" |
| **Crossbar (hardware)** | "The danger of a one-time key is the counter. A one-way hardware counter makes signing twice physically impossible." | The ESP32: clear signing, PIN lock, counter saved before signing. Where the Dabao's counters fit |

## The 4-minute finalist demo (what to click)
1. **Home** (20 s): the problem in one sentence, the six stops.
2. **Discover** (25 s): Optimism Security Council, 4 → 13 of 13.
3. **Scan → ENS name** (40 s): type any name and watch the five paths, the trap and the survey line.
4. **Escape** (50 s): PQ tx, the rescue (❌ ❌ ✅), the forgery card.
5. **Protect → ENS name** (40 s): `lifeboathw.eth` protected by the ESP32. Hold up the device.
6. **Harbour** (25 s): open evidence → MATCHES.
7. **Close** (10 s): "The tools and data are free. Protocols pay for monitoring and migrating. Lifeboat: get off before Q-Day."

## The hardware story (if they ask "how secure is the ESP32?")
**On today, all of it tested:**
- The key is **generated on the device** (its random generator mixed with the laptop's) and never leaves it.
- **Clear signing:** the device rebuilds the hash from the request and shows it in words. It refuses a bare hash, non-canonical encodings, a request for another leaf, and hidden characters. 28 host checks run against the contract, Safe and frame-library hashes, plus the PIN and testnet rules.
- **The counter is saved before signing:** a crash or reset can burn a leaf but never reuse one. A timeout or a rejection uses no leaf.
- **PIN lock:** the seed is stored encrypted. After every power-on the device is locked until the PIN is entered, and the waits grow after 3 wrong tries, even across reboots.
- **Testnet only:** the device refuses any chain except Sepolia and the EIP-8141 devnet, whatever the laptop asks.
- **Wipe:** erasing the key needs the button held for 5 seconds.

**Next, for production:**
- **Flash encryption and secure boot.** These are permanent chip settings: a hardware key that never leaves the chip encrypts the flash, and only our signed firmware runs. We'll do it on a second board first.
- **A one-way counter:** an eFuse bit per signature, or the Dabao's hardware counters.
- **Air-gapped signing:** QR codes instead of USB.

**What we tell them plainly:** today, someone with the device and a lot of time could read its flash and guess a short PIN offline. Flash encryption closes that.

## Beyond ENS: what we can protect next
- **Safes, with the key on the device.** The firmware already understands Quantum Guard co-signatures (it shows the Safe, the nonce and the call in words). Next: install a guard whose post-quantum key is the ESP32.
- **Security councils and bridge admins.** Their signer keys are public through their own signatures, and the Monitor already raises alerts for three councils on Arkiv.
- **Wallets.** A warning before you send to a name whose controller key is public. It works by querying the registry or reading the `pq.*` records (our draft ENSIP).
- **Hardware-wallet makers.** Clear signing for post-quantum one-time keys, plus a counter the host can't roll back.
- **L2s and EIP-8141 chains.** Post-quantum accounts and sponsored rescues as soon as frame transactions ship.
- **Mainnet ENSv2.** The same handover after an audit; mainnet is read-only for us until then.

## Hard questions, short answers
- **"Is this real?"** Every number links to a transaction or a file. The survey covers real names but publishes totals only, and our own test names are labelled as ours.
- **"Is the quantum threat real?"** We ran Shor's algorithm on a real IBM quantum computer (ibm_fez): it recovered the private key of a 2-bit toy curve from its public key, with 69% of the votes on the right key (25% by chance). Real keys are 256-bit, far beyond today's machines. That gap is the time we have to move.
- **"Why hash-based signatures?"** They rest only on hashing, which quantum computers don't shortcut, and verifying one costs 52k gas inside VERIFY.
- **"One-time keys run out."** Each key has 256 leaves; the account enforces the order on chain, and you rotate before you run out.
- **"Why the alt mempool?"** The paymaster reads its registry and a token balance before it pays. The public mempool forbids that, and we have the rejected transaction.
- **"Why Arkiv, not a database?"** Anyone can read it without an account, records expire on their own, the audit trail can't be edited, and the key ledger accepts sightings from anyone.
- **"Where does the account data come from?"** The public chain, read live through public nodes. We keep no database of people.
- **"Isn't this alarmist?"** No quantum computer can do this today. We publish readiness data about public infrastructure, report anything serious privately, and give people a way out.
