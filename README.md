# Lifeboat

**A future quantum computer can take over any wallet whose public key is on-chain, and every signature puts it there, not just sending a transaction. Lifeboat shows who could take over what on Q-Day, and gives each one a way out.**

Built from scratch at ETHGlobal Mumbai (5–7 Nov 2026). On a tiny test key, the attack already works: Shor's algorithm on a real IBM quantum computer turned a 2-bit public key into its private key ([how](docs/quantum-demo.md)). Real keys have 256 bits, and no quantum computer can break one today: these are readiness findings from public on-chain data.

**Live demo: https://lifeboat-mu.vercel.app** · the landing page explains it in a minute; then scan any address, or any ENSv2 name on Sepolia.

New here? Start with [Lifeboat, explained](docs/explainer.md) (every part in plain words, plus judge Q&A), the [business model](docs/business-model.md) and the [roadmap](docs/roadmap.md) (what's production-ready on testnet, what waits for an audit).

| | What | Where it runs |
|---|---|---|
| **Discover** | Hidden exposure: keys revealed by multisig signatures, which a nonce check never sees; and the attack itself, Shor's algorithm on real IBM hardware turning a toy public key into its private key | Ethereum mainnet (live, in the browser) |
| **Scan** | Exposure of any address on 6 chains; a **deep scan of any Safe** (every signer recovered from its own signatures); the **Helm check** of any ENSv2 name across 5 control paths, proven complete | Ethereum mainnet, Sepolia ENSv2 |
| **Escape** | A post-quantum (WOTS+C) account on EIP-8141; a staked **rescue paymaster** for wallets with no ETH; the **forgery** a reused one-time key allows | EIP-8141 alt-mempool devnet (chain 1337) |
| **Protect in place** | **Quantum Guard**: a post-quantum co-signer for an existing Safe (transactions + ERC-1271), lost-key recovery the PQ key can veto, a factory, a one-transaction install. The app's **Protect** tab installs and co-signs on any Sepolia Safe | Safe 1.4.1 on Sepolia |
| **Monitor** | Watch list and alerts on Arkiv: Safes (signature exposure), Quantum Guards (recovery started or completed), names (verdict changes) | Arkiv + Sepolia, Ethereum read-only |
| **Harbour** | A public Q-Day registry and one-time-key ledger | Arkiv (Rabdi), evidence on Swarm |
| **Sign safely** | An ESP32 signer that can't sign twice with one key | Firmware + Web Serial |

## Findings (block-stamped, lower bounds)
- **Optimism Security Council (10 of 13):** 4 public keys by nonce → **13 of 13** counting signatures. **Base's nested 8-of-11 council: 0 → 11.** Two of four council Safes look safe by nonce and aren't. → [docs/discovery.md](docs/discovery.md)
- **Real ENSv2 names (Sepolia, one per owner, our own excluded):** **902 of 1,011** (89%) can be steered on Q-Day, 863 of them through their resolver. Our own test name `lifeboatpq.eth` shows the way out: handed over and protected. → [docs/helm-check.md](docs/helm-check.md)
- **Quantum Guard on a real Safe:** a payment signed by the owners only was **refused on-chain**; the post-quantum co-signed one went through. Signed messages need the PQ key too: **Uniswap's Permit2 refused a permit signed by the owners only** (block 12,077,800) and accepted the same permit after the PQ approval. → [docs/quantum-guard.md](docs/quantum-guard.md)
- **Shor's algorithm on a real IBM quantum computer** (ibm_fez, 156 qubits) recovered our toy curve's private key from its public key: 69% of the votes went to the right key (25% by chance), 3 s of QPU time. It's a 2-bit toy key; real keys are 256-bit and safe today. → [docs/quantum-demo.md](docs/quantum-demo.md)
- **One-time keys:** a wallet that re-signs 12 fee bumps with one leaf can be forged in **0.2 s**. We did it, and drained it, on the live devnet. → [docs/pq-account.md](docs/pq-account.md)

## EF: Frame Transaction Alternative Mempool
_The devnet was reset on 6 Nov at 11:59 IST. We re-ran every demo on the fresh chain the same afternoon, and the blocks below are from that re-run. The first runs are kept in [`evidence/ef/before-reset/`](evidence/ef/before-reset/)._
- **PQ account in Yul** verifying **WOTS+C** in the VERIFY frame: **52,367 gas** for the whole frame, 44,870 for the check itself (constant), 2,336-byte witness in an ARBITRARY signature entry, 256 one-time leaves with an on-chain leaf floor. First tx [`0x115659a9…`](https://explorer.altmempool.wtf/tx/0x115659a935d1fe86a81a445f05d2c20ced792bec617ba43ff0fab4ce07345784?node=https%3A%2F%2Faltmempoolgateway.forshtat.com%2Frpc), block 2,159.
- **Why the alt mempool:** a **staked rescue paymaster** pays gas for exposed wallets that hold tokens but no ETH, and is repaid in USDC in the same transaction. Its VERIFY reads shared state (its registry, and a token balance through a proxy):

  | Route | Result |
  |---|---|
  | public mempool | ❌ `StorageReadNonSender` |
  | alt, unstaked | ❌ `unstaked payer accessed payer slot …` |
  | alt, staked | ✅ [included in block 2,174](https://explorer.altmempool.wtf/tx/0x26462c908a8e4002f73430dabf9844bb51fde79bf6d839210f58f57d394669f3?node=https%3A%2F%2Faltmempoolgateway.forshtat.com%2Frpc) |

  It refuses 5 attack variants (underpaying, paying someone else, an undoable batched repayment, sweeping first, an unregistered sender).
- **Forgery demo:** [`0xa70bda46…`](https://explorer.altmempool.wtf/tx/0xa70bda46414caaadb53430ae8e26ed27fc2f4f8a2c2a0e3be44b2f33988929cb?node=https%3A%2F%2Faltmempoolgateway.forshtat.com%2Frpc), block 2,191: a signature forged from 12 reused fee bumps, accepted by VERIFY, wallet drained.
- Docs: [pq-account.md](docs/pq-account.md) (design, gas, trade-offs, forgery costs) · [rescue-paymaster.md](docs/rescue-paymaster.md) (admission demo, guards, devnet feedback).

## ENS: Best Use of ENSv2
- **Helm check** for **any** ENSv2 name (nothing hard-coded). Five control paths: owner, delegates (EAC roles), operators, resolver role holders (incl. `UPGRADE`), parent registries. Holders are rebuilt from `EACRolesChanged` logs and **proven complete** (the sum of role bitmaps equals `roleCount`).
- **Registry-verified handover** to a WOTS+C wallet:
  1. The naive transfer is refused (`TransferUnsafeWithMultipleAssignees`).
  2. Lifeboat deploys a new resolver, points the name at it, revokes the delegate and removes the operator.
  3. The transfer is accepted.
  4. The PQ wallet writes its own `pq.checked` with a hash-based signature.
- **With a hardware key:** our test name `lifeboathw.eth` now belongs to a post-quantum wallet whose key exists only on the ESP32. The wallet's address follows from the device's public key, so nothing is saved, and the Helm check recognises it from the chain alone. The first record change was shown on the device's screen (`setText · name lifeboathw.eth · key pq.checked`) and signed after the button press. In the app: **Protect → ENS name**.
- **Draft ENSIP** for `pq.*` text records: [pq-records.md](docs/pq-records.md). Every tx hash: [helm-check.md](docs/helm-check.md).

## Arkiv: Build on Arkiv (+ Swarm)
- **Six schemas** ([schema](arkiv/schema.md)):
  - exposure readings and name verdicts (24 h, updated in place on every re-check);
  - aboard moves and a one-time-key **leaf ledger** (readonly, 180 days, anyone can extend). Anyone can write to the ledger, and two digests for one leaf raise **"signed twice"**, which caught our naive test wallet;
  - Monitor watches and alerts (30 days).
- **In the app (Harbour, Check, Monitor):**
  - only records our publisher signed (`ownedBy`), so nobody can plant a fake "moved to safety";
  - true totals from the count API, and "newest" and "most at risk" ordering;
  - the whole ledger, paged by key;
  - severity filters in the query;
  - "expires in" countdowns, and readonly stamps read from each entity's creation flags;
  - an explorer link on every row.
- **A publisher that re-verifies every claim on-chain** before writing. A re-check patches and extends the same record in one `executeBatch`, so keys stay stable.
- **Writer wallet:** `0xBAc277e47dd7B95c04BB3517b76c1dd9151A054a` (Rabdi, chain 7794095).
- **Runnable query** (no access key, no `.env`): exposed keys plus the "signed twice" check.
  ```bash
  pnpm install && node scripts/arkiv-query-public.mjs
  ```
- **Swarm:** full evidence files (Helm reports, rescue, forgery, council scan) uploaded and pinned by our own Bee light node (batch `d65b35d8…7bae`). Arkiv records carry `swarmRef` and `evidenceHash`, and the app's **open evidence** downloads the file, hashes it in the browser and shows "Swarm file matches the Arkiv record" → [swarm](arkiv/swarm.md).
- **Lifetimes at judging:** readings live 24 h and are re-published daily (`pnpm --filter @lifeboat/scripts refresh`). The ledger and aboard records live 180 days, so the query is never empty.
- **Public read quota:** keyless reads share a per-IP quota. If Harbour says it's used up, wait a few minutes.
- Docs: [schema](arkiv/schema.md) · [why Arkiv](arkiv/why-arkiv.md) · [how we use it](arkiv/how-you-use-arkiv.md) · [reach](arkiv/reach.md) · [friction](arkiv/friction.md) · [swarm](arkiv/swarm.md)

## Hardware
ESP32 signer, **live**: it generated its own key and signed a frame transaction that was included on chain 1337 ([`0x6836931d…`](https://explorer.altmempool.wtf/tx/0x6836931d3ad4ff86713e552e2ef3d2d49a84d62676f3ef816c77a580fdf66737?node=https%3A%2F%2Faltmempoolgateway.forshtat.com%2Frpc), block 2,687) after it showed the transaction in words and the BOOT button was pressed on the device. The secret seed and the leaf counter stay on the device. **Clear signing:** it never signs a bare hash. It gets the request itself (a message, a post-quantum wallet action such as an ENS record, a Safe co-signature, or a frame transaction), rebuilds the hash from it, and shows it in words on its OLED: amounts, full recipient, ENS name, `! DELEGATECALL`. It needs the Approve button on the last page, saves the counter **before** signing, and refuses a counter that doesn't match its own digest. Its crypto core is verified byte for byte against the TypeScript signer (`node tools/firmware-check.mjs`). → [docs/hardware.md](docs/hardware.md)

## Repo
| Folder | What | Tests |
|---|---|---|
| `packages/pq` | WOTS+C: keys, signing, verification, Merkle tree, forgery analysis | 17 (vitest) |
| `packages/core` | Helm check, Safe deep scan, exposure check, Arkiv schemas (shared by scripts and app) | 3 (vitest: Safe signature recovery) |
| `contracts` | Yul PQ account + WOTS+C core (templated), Yul rescue paymaster, Sepolia PQ wallet, **Quantum Guard + factory**, mock USDC | 36 (Foundry, TypeScript vectors) |
| `scripts` | deploy, sign, dry-run, submit, rescue, guards, forgery, ENS setup/handover, Helm check, Arkiv publish/query, Swarm, council scan | live runs, evidence in `evidence/` |
| `app` | the web app (Vite + React + viem + Arkiv SDK) | typechecked; Protect tab end to end on Sepolia (`e2e-protect`, evidence in `evidence/e2e/`) |
| `firmware/esp32` | the signer, with clear signing | 22 host checks vs TypeScript vectors (`node tools/firmware-check.mjs`) |
| `quantum` | Shor's algorithm for the elliptic-curve discrete log on toy curves: simulators and IBM quantum hardware | ideal + noisy simulation; hardware run → [docs/quantum-demo.md](docs/quantum-demo.md) |
| `video` | the narrated walkthrough: offline TTS, scripted recording, MP4 + subtitles | renders in about 10 minutes |

## Run it
```bash
pnpm install
pnpm --filter @lifeboat/pq test
node tools/gen-yul.mjs && node tools/build-yul.mjs && (cd contracts && forge test)
pnpm --filter @lifeboat/app dev                       # the web app
pnpm --filter @lifeboat/scripts helm lifeboatpq.eth   # any ENSv2 name on Sepolia
pnpm --filter @lifeboat/scripts ens-survey           # real names, one per owner (aggregates only)
pnpm --filter @lifeboat/scripts quantum-guard        # Quantum Guard on a real Safe (needs .env)
pnpm --filter @lifeboat/scripts guard-permit2        # the same Safe against Uniswap's real Permit2 (needs .env)
pnpm --filter @lifeboat/scripts guard-lifecycle      # v2: install, co-sign, veto, timelocked recovery (Sepolia)
pnpm --filter @lifeboat/scripts monitor              # one Monitor pass (alerts to Arkiv + optional webhook)
pnpm --filter @lifeboat/scripts e2e-protect          # Protect tab in a real browser with a test wallet (app on :5173)
pnpm --filter @lifeboat/scripts council-scan          # hidden exposure, mainnet
pnpm --filter @lifeboat/scripts rescue                # three-way admission (needs .env)
node tools/firmware-check.mjs                         # firmware crypto vs TypeScript (needs Docker)
```
Scripts read `.env` (see `.env.example`). Secrets live in `.env` and `secrets/`, both gitignored and guarded by a pre-commit hook. → [SECURITY.md](SECURITY.md)

## Credits and prior art
- Fee-bump one-time-key reuse is known in the hash-based-signature community; we credit it and show it live.
- The Safe co-signer guard pattern comes from Safe Research.
- PQ accounts: Kohaku, ZKNox, Tectonic.
- Lifeboat is the **evacuation layer**: any PQ account (including leanSPHINCS when it ships) can be the destination.
- Libraries: `@forshtat/hegota-support` (frame-tx codec, MIT), `@arkiv-network/sdk`, viem, @noble/hashes, forge-std.

## AI usage
See [docs/ai-usage.md](docs/ai-usage.md).

## Licence
MIT, see [LICENSE](LICENSE).
