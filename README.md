# Lifeboat

**A future quantum computer can take over any wallet whose public key is on-chain, and every signature puts it there, not just sending a transaction. Lifeboat shows who could take over what on Q-Day, and gives each one a way out.**

Built from scratch at ETHGlobal Mumbai (5–7 Nov 2026). No quantum computer can do this today: these are readiness findings from public on-chain data.

**Live demo: https://lifeboat-mu.vercel.app** · the landing page explains it in a minute; then scan any address, or any ENSv2 name on Sepolia.

New here? Start with [Lifeboat, explained](docs/explainer.md) (every part in plain words, plus judge Q&A) and the [business model](docs/business-model.md).

| | What | Where it runs |
|---|---|---|
| **Discover** | Hidden exposure: keys revealed by multisig signatures, which a nonce check never sees | Ethereum mainnet (live, in the browser) |
| **Scan** | Exposure of any address on 6 chains; a **deep scan of any Safe** (every signer recovered from its own signatures); the **Helm check** of any ENSv2 name across 5 control paths, proven complete | Ethereum mainnet, Sepolia ENSv2 |
| **Escape** | A post-quantum (WOTS+C) account on EIP-8141; a staked **rescue paymaster** for wallets with no ETH; the **forgery** a reused one-time key allows | EIP-8141 alt-mempool devnet (chain 1337) |
| **Protect in place** | **Quantum Guard**: a post-quantum co-signer for an existing Safe, covering transactions and ERC-1271 signatures | A real Safe 1.4.1 on Sepolia |
| **Harbour** | A public Q-Day registry and one-time-key ledger | Arkiv (Rabdi), evidence on Swarm |
| **Sign safely** | An ESP32 signer that can't sign twice with one key | Firmware + Web Serial |

## Findings (block-stamped, lower bounds)
- **Optimism Security Council (10 of 13):** 4 public keys by nonce → **13 of 13** counting signatures. **Base's nested 8-of-11 council: 0 → 11.** Two of four council Safes look safe by nonce and aren't. → [docs/discovery.md](docs/discovery.md)
- **Real ENSv2 names (Sepolia, one per owner, our own excluded):** **902 of 1,011** (89%) can be steered on Q-Day, 863 of them through their resolver. Our own test name `lifeboatpq.eth` shows the way out: handed over and protected. → [docs/helm-check.md](docs/helm-check.md)
- **Quantum Guard on a real Safe:** a payment signed by the owners only was **refused on-chain**; the post-quantum co-signed one went through, and ERC-1271 (Permit2) now needs the PQ key too. → [docs/quantum-guard.md](docs/quantum-guard.md)
- **One-time keys:** a wallet that re-signs 12 fee bumps with one leaf can be forged in **0.1 s**. We did it, and drained it, on the live devnet. → [docs/pq-account.md](docs/pq-account.md)

## EF: Frame Transaction Alternative Mempool
- **PQ account in Yul** verifying **WOTS+C** in the VERIFY frame: **52,369 gas** for the whole frame, 44,870 for the check itself (constant), 2,336-byte witness in an ARBITRARY signature entry, 256 one-time leaves with an on-chain leaf floor. First tx [`0xd999725a…`](https://explorer.altmempool.wtf/tx/0xd999725ac312ca2cccfcebfbae84e66560c6587f052af6aa919622fc6a0f8ef0?node=https%3A%2F%2Faltmempoolgateway.forshtat.com%2Frpc), block 403,931.
- **Why the alt mempool:** a **staked rescue paymaster** pays gas for exposed wallets that hold tokens but no ETH, and is repaid in USDC in the same transaction. Its VERIFY reads shared state (its registry, and a token balance through a proxy):

  | Route | Result |
  |---|---|
  | public mempool | ❌ `StorageReadNonSender` |
  | alt, unstaked | ❌ `unstaked payer accessed payer slot …` |
  | alt, staked | ✅ [included in block 404,050](https://explorer.altmempool.wtf/tx/0x26462c908a8e4002f73430dabf9844bb51fde79bf6d839210f58f57d394669f3?node=https%3A%2F%2Faltmempoolgateway.forshtat.com%2Frpc) |

  It refuses 5 attack variants (underpaying, paying someone else, an undoable batched repayment, sweeping first, an unregistered sender).
- **Forgery demo:** [`0x8dc6c9fb…`](https://explorer.altmempool.wtf/tx/0x8dc6c9fbbadd0e4345557d938f4333a35c726ebbb753493c5edc1726fee6d890?node=https%3A%2F%2Faltmempoolgateway.forshtat.com%2Frpc), block 405,633: a signature forged from 12 reused fee bumps, accepted by VERIFY, wallet drained.
- Docs: [pq-account.md](docs/pq-account.md) (design, gas, trade-offs, forgery costs) · [rescue-paymaster.md](docs/rescue-paymaster.md) (admission demo, guards, devnet feedback).

## ENS: Best Use of ENSv2
- **Helm check** for **any** ENSv2 name (nothing hard-coded). Five control paths: owner, delegates (EAC roles), operators, resolver role holders (incl. `UPGRADE`), parent registries. Holders are rebuilt from `EACRolesChanged` logs and **proven complete** (the sum of role bitmaps equals `roleCount`).
- **Registry-verified handover** to a WOTS+C wallet:
  1. The naive transfer is refused (`TransferUnsafeWithMultipleAssignees`).
  2. Lifeboat deploys a new resolver, points the name at it, revokes the delegate and removes the operator.
  3. The transfer is accepted.
  4. The PQ wallet writes its own `pq.checked` with a hash-based signature.
- **Draft ENSIP** for `pq.*` text records: [pq-records.md](docs/pq-records.md). Every tx hash: [helm-check.md](docs/helm-check.md).

## Arkiv: Build on Arkiv (+ Swarm)
- **Four schemas:** exposure (24 h), aboard (readonly audit trail), name verdicts, and a **leaf ledger** that anyone can write to. Two digests for one leaf raise **"signed twice"**, which the ledger caught for the naive wallet.
- **A publisher that re-verifies every claim on-chain** before batch-writing.
- **Writer wallet:** `0xBAc277e47dd7B95c04BB3517b76c1dd9151A054a` (Rabdi, chain 7794095).
- **Runnable query** (no access key needed):
  ```bash
  pnpm install && node scripts/arkiv-query-public.mjs
  ```
- **Swarm:** 8 evidence bundles uploaded by our own Bee light node (batch `d65b35d8…7bae`) and referenced from Arkiv entities via `swarmRef`. 8 of 8 open on the public testnet gateway.
- Docs: [schema](arkiv/schema.md) · [why Arkiv](arkiv/why-arkiv.md) · [how we use it](arkiv/how-you-use-arkiv.md) · [reach](arkiv/reach.md) · [friction](arkiv/friction.md) · [swarm](arkiv/swarm.md)

## Hardware
ESP32 signer, **live**: it generated its own key and signed a frame transaction that was included on chain 1337 ([`0x69c1eaec…`](https://explorer.altmempool.wtf/tx/0x69c1eaec36a29185a599ebead5a0662a7198683c352ba98e88dda3daeaf39213?node=https%3A%2F%2Faltmempoolgateway.forshtat.com%2Frpc), block 406,887) after the BOOT button was pressed on the device. The secret seed and the leaf counter stay on the device. It shows each request on an OLED, needs the Approve button, saves the counter **before** signing, and refuses a counter that doesn't match its own digest. Its crypto core is verified byte for byte against the TypeScript signer (`node tools/firmware-check.mjs`). → [docs/hardware.md](docs/hardware.md)

## Repo
| Folder | What | Tests |
|---|---|---|
| `packages/pq` | WOTS+C: keys, signing, verification, Merkle tree, forgery analysis | 17 (vitest) |
| `packages/core` | Helm check, Safe deep scan, exposure check, Arkiv schemas (shared by scripts and app) | 3 (vitest: Safe signature recovery) |
| `contracts` | Yul PQ account + WOTS+C core (templated), Yul rescue paymaster, Sepolia PQ wallet, **Quantum Guard**, mock USDC | 32 (Foundry, TypeScript vectors) |
| `scripts` | deploy, sign, dry-run, submit, rescue, guards, forgery, ENS setup/handover, Helm check, Arkiv publish/query, Swarm, council scan | live runs, evidence in `evidence/` |
| `app` | the web app (Vite + React + viem + Arkiv SDK) | typechecked, verified in the browser |
| `firmware/esp32` | the signer | host test vs TypeScript vectors |
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
