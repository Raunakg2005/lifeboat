# ETHGlobal Mumbai: the submission form, ready to paste

Every field below is final and checked against `evidence/`. Copy each block into the matching form field.

---

## Project name
```
Lifeboat
```

## Short description (≤ 100 characters)
```
Finds wallets, Safes and ENS names exposed to Q-Day, and moves them to post-quantum keys.
```

## Description
```
Every time you sign anything on Ethereum, your public key goes on-chain, and a future quantum computer could turn that public key into your private key. On a tiny test key, that attack already works: Shor's algorithm on a real IBM quantum computer (ibm_fez) turned a 2-bit public key into its private key. Real Ethereum keys have 256 bits, and no quantum computer can break one today. Lifeboat is about getting ready.

Lifeboat shows who could take over what, then gets them out:

1. Find what's exposed. It recovers signer keys from a multisig's own signatures, which a "has this address ever sent a transaction?" check never sees. Optimism's Security Council goes from 4 to 13 of 13 public keys, and Base's nested council from 0 to 11. Any Safe can be checked live in the browser.

2. Names too. The Helm check maps every key that can steer an ENSv2 name across five control paths and proves the list is complete. Across 1,011 real Sepolia names (one per owner), 902 can be steered on Q-Day, 863 of them through their resolver.

3. Get out, three ways:
   - a post-quantum account (WOTS+C, hash-based) checked inside an EIP-8141 frame transaction, plus a staked rescue paymaster so a wallet with tokens but no ETH can still escape;
   - Quantum Guard: a post-quantum co-signer for a Safe you already have, with owner recovery that the post-quantum key can veto;
   - a registry-verified ENS handover to a post-quantum wallet.

4. Sign safely. Our ESP32 signer generates its own key, never signs a bare hash (it rebuilds the request and shows it in words), saves its counter before every signature, and is PIN-locked. Our test name lifeboathw.eth is now owned by a wallet whose key exists only on that device.

5. Public and checkable. Every finding is re-checked and published to Arkiv; the full evidence sits on Swarm, and the app re-hashes it in your browser to prove it matches.

The tools and data are free; protocols pay for monitoring and help migrating.
```

## How it's made
```
Contracts. The post-quantum account and the rescue paymaster are pure Yul, using verbatim for the EIP-8141 opcodes (APPROVE, SIGPARAM, SIGDATACOPY, TXPARAM, FRAMEPARAM, FRAMEDATALOAD). The WOTS+C core is templated so the account and a Foundry harness compile the same code; a generator unrolls the hash-chain walk (68k → 45k gas) and the digit sum uses SWAR. VERIFY costs 52,367 gas for a 2,336-byte witness. Quantum Guard (Solidity, via-IR for one file) is a Safe 1.4.1 transaction guard plus ERC-1271 handler with a leaf bitmap, key rotation and a timelocked recovery the PQ key can veto; a CREATE2 factory installs it in one MultiSendCallOnly transaction. 36 Foundry tests run against vectors from the TypeScript signer.

Frame transactions are built with @forshtat/hegota-support, dry-run with ethrex_simulateFrameTransaction and sent through the ERC-8421 alt mempool. The rescue shows the same signed transaction rejected by the public mempool (StorageReadNonSender) and by the unstaked alt mempool, then included once the paymaster is staked; five attack variants are refused.

ENSv2: the Helm check (viem, Sourcify ABIs) rebuilds role holders from EACRolesChanged logs and proves completeness against roleCount, across the owner, EAC delegates, ERC-1155 operators, PermissionedResolver roles (incl. UPGRADE) and parent registries. The handover deploys a fresh PermissionedResolver through VerifiableFactory, re-points the name, revokes the other holders and transfers it; ENSv2 itself refuses the naive transfer (TransferUnsafeWithMultipleAssignees). A hardware-key variant gives each ESP32 its own LifeboatPQWallet via CREATE2 (salt = the device's key root), so the wallet is found from the device alone.

Hardware: ESP32 firmware in portable C++ (Keccak, WOTS+C, an RLP/ABI decoder for clear signing, a PIN-encrypted seed, testnet-only rules). 28 host checks compile the same code in an Alpine container and compare it byte for byte with the TypeScript signer. The browser talks to it over Web Serial.

Arkiv (@arkiv-network/sdk 1.0.1): six schemas, readonly + permissionless-extension audit records, an open one-time-key ledger that flags "signed twice", records updated in place (patch + extend in one executeBatch), count queries, keyset paging and keyless reads. Swarm: our own Bee 2.8.3 light node in Docker uploads the evidence; records carry swarmRef + evidenceHash, and the app re-hashes the file in the browser.

App: Vite + React + viem on Vercel with a strict CSP, EIP-6963 wallet discovery and per-tab error boundaries. An end-to-end Playwright test drives the Protect tab with a scripted wallet on Sepolia.

Quantum: Shor's algorithm for the elliptic-curve discrete log in Qiskit, on toy curves with 2- and 3-bit keys. The point-addition gates are compiled from the toy curve's addition table, run on Qiskit Aer (ideal, and IBM's Torino noise model), then on real IBM hardware through Qiskit Runtime. On ibm_fez (Heron, 156 qubits) the 2-bit key came back right: k = 3 with 1,333 of 1,942 votes (69%; 25% by chance), 46 two-qubit gates, 3 s of QPU time, job dbmtusm74qds73dsvrf0. The raw counts are in the repo, and the Discover tab draws them.
```

## Links
| Field | Value |
|---|---|
| GitHub | https://github.com/Raunakg2005/lifeboat (**make it public first**) |
| Live demo | https://lifeboat-mu.vercel.app |
| Video | **upload the file** `video/out/lifeboat-submission.mp4` to ETHGlobal.com itself (3:55, 1280×720, voice only, no music; remade 6 Nov 21:48 IST with the IBM line) |

## Tech stack (pick the closest options in each dropdown)
| Category | Pick |
|---|---|
| Ethereum developer tools | Foundry, viem |
| Blockchain networks | Ethereum Sepolia, Ethereum mainnet (read-only scans), the EIP-8141 alt-mempool devnet (chain 1337; type it under "other") |
| Programming languages | TypeScript, Solidity, Yul (or "other"), C++, Python |
| Web frameworks | React, Vite |
| Databases | Arkiv (type it if it isn't listed); storage: Swarm |
| Design tools | none |
| Other | ENSv2, Safe, ESP32 (Arduino), Web Serial, Docker, Playwright, Qiskit, IBM Quantum (ibm_fez), WOTS+C |

## Prizes
- **Finalist + partner prizes**, with these three partner picks:
  1. **Ethereum Foundation: Best use of the Frame Transaction Alternative Mempool**
  2. **ENS: Best Use of ENSv2**
  3. **Arkiv: Build on Arkiv (from scratch)**, and **tick the Arkiv + Swarm bonus**. It's part of the Arkiv pick, not a fourth one.

### If the form asks "how does your project use <partner>?"

**Ethereum Foundation (frame tx alt mempool)**
```
A post-quantum account in Yul verifies a WOTS+C hash-based signature inside the EIP-8141 VERIFY frame: 52,367 gas, constant cost, 2,336-byte ARBITRARY witness, with an on-chain leaf floor against reuse. The reason it needs the alternative mempool is a staked rescue paymaster: it reads its registry and a proxied token balance during validation, so a wallet holding tokens but no ETH can still escape, repaying the gas in USDC in the same transaction. The same signed transaction is rejected by the public mempool (StorageReadNonSender) and by the unstaked alt mempool, and included once the paymaster is staked; five attack variants are refused. We also forge a signature from 12 reused fee bumps (0.2 s) to show why one-time keys need a counter, and our ESP32 clear-signs frame transactions (block 2,687).
```

**ENS (best use of ENSv2)**
```
Lifeboat checks and changes who controls a name through ENSv2's own architecture. The Helm check maps all five control paths (owner, EAC delegates, operators, PermissionedResolver roles incl. UPGRADE, parent registries), rebuilds holders from EACRolesChanged and proves completeness against roleCount; 902 of 1,011 real Sepolia names (one per owner) can be steered on Q-Day, 863 through their resolver. The handover is verified by the registry: the naive transfer is refused (TransferUnsafeWithMultipleAssignees); a fresh PermissionedResolver via VerifiableFactory, revoked holders and removed operators make it accepted. With a hardware key: our test name lifeboathw.eth now belongs to a post-quantum wallet whose key lives only on an ESP32, and every record change is shown on the device and signed after a button press. The live app (Protect → ENS name) runs this for any name. Draft ENSIP for pq.* records included.
```

**Arkiv (+ Swarm)**
```
Arkiv is Lifeboat's public Q-Day registry: exposure readings that expire after 24 h and are updated in place, readonly "aboard" records of verified moves to post-quantum accounts, ENS verdicts, Monitor watches and alerts, and an open one-time-key ledger where anyone can report a sighting; two digests for one leaf raise "signed twice". The app reads only records our publisher signed (ownedBy), shows readonly stamps from creation flags, true totals from the count API, keyset paging and explorer links. Swarm holds the full evidence (Helm reports, rescue, forgery, council scan) from our own Bee node; each record carries swarmRef + evidenceHash, and the app re-hashes the file in the browser to show it matches. Docs: arkiv/schema.md, why-arkiv.md, how-you-use-arkiv.md, reach.md, friction.md, swarm.md.
```

### The prize form, per partner (short "why", code link, feedback)
Track: **Building from Scratch**. Submission type: **Top 10 Finalist & Partner Prizes** (live judging Sat 7 Nov, 09:30 IST). Other partners' technologies: none beyond these three. Ease ratings are the team's call; the numbers below are only a suggestion.

**Arkiv** · code: https://github.com/Raunakg2005/lifeboat/blob/0fc9eaf09f90f851200b8fb1b6a0f37135520aab/scripts/src/lib/publish.ts#L205 · ease: 7
```
Arkiv is Lifeboat's public Q-Day registry: exposure readings that expire after 24 h and are updated in place (patch + extend in one executeBatch), readonly records of verified moves to post-quantum accounts, ENSv2 verdicts, Monitor alerts, and an open one-time-key ledger anyone can write to, which flags a key that "signed twice". The full evidence sits on Swarm from our own Bee node; each record carries swarmRef + evidenceHash, and the app re-hashes the file in the browser to show it matches (Arkiv + Swarm).
```
```
Most wanted: (1) an upsert or a "latest per attribute set" query; re-checks piled up as duplicates until we patched and extended in one batch. (2) API docs that match 1.0.1: the reference lists ne, not, bytes32 and tiramisu, which 1.0.1 doesn't export. (3) NOT / !=: the parser suggests NOT (a = b), which then fails with "store: NotImplemented". (4) limit above 100 errors and points to an offset API we couldn't find; keyset paging works. (5) The keyless 429 sends a multi-minute Retry-After that viem honours, so pages hang; please document the quota and whether a browser-safe key exists. (6) Document the explorer and indexer URL patterns. Full log with repro steps: arkiv/friction.md in our repo.
```

**Ethereum Foundation** · code: https://github.com/Raunakg2005/lifeboat/blob/0fc9eaf09f90f851200b8fb1b6a0f37135520aab/contracts/yul/LifeboatAccount.yul.tmpl#L39-L52 · ease: 6
```
Our post-quantum account (pure Yul) checks a WOTS+C hash-based signature natively in the EIP-8141 VERIFY frame: 52,367 gas, constant, a 2,336-byte witness and an on-chain leaf floor. Our staked rescue paymaster reads its registry and a token balance during validation, so the same signed transaction is refused by the public mempool (StorageReadNonSender) and by the unstaked alt mempool, and included once staked (block 2,174): a wallet with tokens but no ETH can still escape. Our ESP32 also clear-signs frame transactions (block 2,687).
```
```
(1) FRAMEPARAM and FRAMEDATALOAD work on chain 1337 (index on top for FRAMEPARAM, offset on top for FRAMEDATALOAD), but the hegota-support helpers still mark them "not yet exercised". (2) NaiveStakingRegistry.getDepositInfo returns three words (stake, unstake delay, withdraw time), not the five-field ERC-4337 struct. (3) explainRejection returns UNKNOWN for the sidecar's "unstaked payer accessed payer slot" rejection. (4) A new storage slot costs about 98k state gas, so a token mint needs a ~250k gas limit; worth a docs note. (5) The devnet reset at 11:59 IST on 6 Nov wiped our transactions mid-hackathon; an announcement channel or a kept explorer snapshot would help. ethrex_simulateFrameTransaction was the most useful tool for debugging VERIFY before sending.
```

**ENS** · code: https://github.com/Raunakg2005/lifeboat/blob/0fc9eaf09f90f851200b8fb1b6a0f37135520aab/packages/core/src/helm.ts#L59-L85 · ease: 7
```
Lifeboat checks and changes who controls a name through ENSv2's own design. The Helm check maps all five control paths (owner, EAC delegates, operators, PermissionedResolver roles incl. UPGRADE, parent registries), rebuilds holders from EACRolesChanged and proves the list complete against roleCount: 902 of 1,011 real Sepolia names (one per owner) can be steered on Q-Day, 863 through their resolver. The handover is checked by the registry itself (the naive transfer is refused with TransferUnsafeWithMultipleAssignees), and our test name lifeboathw.eth now belongs to a post-quantum wallet whose key exists only on an ESP32.
```
```
(1) roleCount plus EACRolesChanged made "who can steer this name" provable, which is the core of our check, and TransferUnsafeWithMultipleAssignees is a great safety net against a half-done transfer. (2) On a shared resolver, per-name record setters can't be proven complete from roleCount, so our report marks them "not proven"; a per-name count or an enumerable holder list would close that. (3) We read ABIs from Sourcify; a published package of ABIs and addresses per network would make this a one-line import. (4) Public load-balanced Sepolia RPCs can answer a block behind, so a freshly regenerated token id briefly looks missing; worth a docs note.
```

## AI usage (if asked)
```
See docs/ai-usage.md in the repo: which tools we used, where, and what the team did.
```

---

## Before you press submit
- [ ] The repo is **public**.
- [ ] The video MP4 is uploaded to ETHGlobal.com (the file, not a link). Voice only, no music.
- [ ] Live site checked (done 6 Nov, 19:55 IST: new build, Protect works, evidence MATCHES).
- [ ] Morning refresh run (`pnpm --filter @lifeboat/scripts refresh`), and `arkiv/swarm.md` references updated afterwards.
- [x] `docs/ai-usage.md` → "What the team did" reviewed by the team.
- [x] The IBM job `dbmtusm74qds73dsvrf0` collected and added to `docs/quantum-demo.md` (ibm_fez returned the 2-bit key, 6 Nov 21:04 IST).
- [ ] Vercel redeployed after the IBM result (`vercel deploy deploy\lifeboat --prod`), so Discover shows the hardware run.
