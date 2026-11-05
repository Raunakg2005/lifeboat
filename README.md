# Lifeboat

A future quantum computer can take over any wallet whose public key is on-chain, and every signature puts it there, not just sending a transaction. Lifeboat shows who could take over what on Q-Day, and gives each one a way out.

Built from scratch at ETHGlobal Mumbai (5–7 Nov 2026).

> Work in progress. This README is filled in as each part lands, with real numbers and links only.

## Live result: a post-quantum signed frame transaction through the alt mempool

A LifeboatAccount verifies a **WOTS+C hash-based signature** (no ECDSA anywhere) inside an EIP-8141 VERIFY frame. Its first transaction went through the ERC-8421 alt-mempool gateway and landed on chain 1337:

| | |
|---|---|
| Transaction | [`0xd999725a…6a0f8ef0`](https://explorer.altmempool.wtf/tx/0xd999725ac312ca2cccfcebfbae84e66560c6587f052af6aa919622fc6a0f8ef0?node=https%3A%2F%2Faltmempoolgateway.forshtat.com%2Frpc), block 403,931, status success |
| Account | `0x555B4f232D65ED910F30F8897FA83705E35824dc` (CREATE2, Yul, 2,294 bytes) |
| VERIFY frame gas | **52,369** used (60,000 declared, under the 100k prefix cap) |
| WOTS+C core alone | 44,870 gas (Foundry, constant for every valid signature) |
| Signature (witness) | 2,336 bytes, ARBITRARY scheme entry |
| Raw evidence | [`evidence/ef/`](evidence/ef/) |

Design, gas and trade-offs: [docs/pq-account.md](docs/pq-account.md).

## Live result: a token-only wallet escapes with no ETH (why the alt mempool is needed)

An exposed wallet with **0 ETH and 100 mUSDC** swept its tokens into the PQ account. A staked **rescue paymaster** paid the gas and was repaid 1 mUSDC inside the same frame transaction. The paymaster's VERIFY reads shared state (its registry of exposed accounts, and the token balance through an upgradeable proxy), which only the alt mempool allows, and only for a staked sponsor:

| Route | Result |
|---|---|
| Canonical mempool | ❌ `StorageReadNonSender` |
| Alt mempool, paymaster unstaked | ❌ `unstaked payer accessed payer slot …` |
| Alt mempool, paymaster staked (0.012 ETH) | ✅ [included in block 404,050](https://explorer.altmempool.wtf/tx/0x26462c908a8e4002f73430dabf9844bb51fde79bf6d839210f58f57d394669f3?node=https%3A%2F%2Faltmempoolgateway.forshtat.com%2Frpc) |

The paymaster also enforces its own repayment: it refused all five attack dry-runs (underpaying, paying someone else, an undoable batched repayment, sweeping first, an unregistered sender). Details: [docs/rescue-paymaster.md](docs/rescue-paymaster.md).

## Live result: ENSv2 Helm check and a registry-verified handover (Sepolia)

Moving the money isn't enough: if an exposed key can still steer your **name**, it can redirect every payment sent to it. The Helm check finds every account that controls an ENSv2 name across **five paths** (owner, delegates, operators, resolver role holders, parent registries), **proves the list complete** against the on-chain role counts, and flags which keys are already public.

| `lifeboatpq.eth` | Verdict |
|---|---|
| Before | 🔴 **hijackable on Q-Day** through paths 1–4 (exposed owner, delegate, operator, and resolver admin with `UPGRADE`) |
| Naive transfer to the PQ wallet | ❌ refused by the registry: `TransferUnsafeWithMultipleAssignees` |
| Lifeboat handover (new resolver → setResolver → revoke → remove operator → transfer) | ✅ accepted |
| After | 🟢 **protected**: owner and every resolver role held by the WOTS+C wallet, which then signed its own `pq.checked` record |

Details and every tx hash: [docs/helm-check.md](docs/helm-check.md). The records are a draft ENSIP: [docs/pq-records.md](docs/pq-records.md).

## Live result: a public Q-Day registry on Arkiv (Rabdi testnet)

Lifeboat publishes what it verifies to Arkiv, so anyone can check it without trusting us or asking for an API:
- **exposure attestations**, 24 h expiry: is this key already public, and how do we know
- **"aboard" records**: verified moves to PQ accounts, readonly
- **ENS Helm check verdicts**
- **a leaf ledger**: every use of a one-time key. Anyone can report a sighting, and two different digests for one leaf raise **"signed twice: this key can be forged"**

The publisher **re-verifies every claim on-chain before writing**. The first batch passed 7 checks, then wrote 12 entities in one transaction (`0x54665e1f…d07f`, 0.0032 tGLM).

- **Writer wallet:** `0xBAc277e47dd7B95c04BB3517b76c1dd9151A054a` (Rabdi, chain 7794095)
- **Runnable query** (no access key needed):
  ```bash
  pnpm install && node scripts/arkiv-query-public.mjs
  ```
  It lists the exposed keys vouched for by the writer, through `and(eq("arkiv.schema", "lifeboat.exposure.v1"), eq("status", "exposed"))` + `.ownedBy(writer)`.
- Docs: [schema](arkiv/schema.md) · [why Arkiv](arkiv/why-arkiv.md) · [how we use it](arkiv/how-you-use-arkiv.md) · [reach](arkiv/reach.md) · [friction](arkiv/friction.md)

## Parts

| Part | Folder | Status |
|---|---|---|
| WOTS+C post-quantum signatures (TypeScript) | `packages/pq` | done: 13 tests |
| PQ account on EIP-8141 frame transactions (Yul) | `contracts/yul` | done: 9 Foundry tests against TypeScript vectors |
| Rescue paymaster (Yul) + mock USDC behind an EIP-1967 proxy | `contracts` | done: 6 Foundry tests + 6 devnet guard dry-runs |
| PQ wallet for Sepolia (WOTS+C-verified `execute`, owns ENS names) | `contracts/src` | done: 8 Foundry tests with TypeScript signatures |
| ENSv2 Helm check + handover | `scripts/src/lib/helm.ts`, `scripts/src/ens-*.ts` | done, live on Sepolia |
| Arkiv registry: 4 schemas, verifying publisher, Harbour queries, leaf ledger | `scripts/src/lib/arkiv.ts`, `scripts/src/arkiv-*.ts` | done, live on Rabdi |
| Devnet scripts (deploy, sign, dry-run, submit, sponsor, capture evidence) | `scripts` | done |

## How it works (short)

- **WOTS+C** (w = 16, 64 chains, keccak): the signer grinds a counter until the digest's digits sum to exactly 560, so no checksum chains are needed and the verifier always does exactly 400 hashes.
- **256 one-time leaves** under an index-bound Merkle root. Every signing attempt takes a fresh leaf, written to disk before the signature leaves the wallet, and each landed transaction raises an on-chain **leaf floor**, so an old or reused leaf can never pass VERIFY again.
- The Yul core is shared by the account and a calldata harness, so Foundry tests the exact code that runs on-chain.

## Run it

```bash
pnpm install
pnpm --filter @lifeboat/pq test
node tools/gen-yul.mjs && node tools/build-yul.mjs && (cd contracts && forge test -vv)
pnpm --filter @lifeboat/scripts deploy-account --label demo
pnpm --filter @lifeboat/scripts send-frame --label demo --verify-gas 60000 --send
pnpm --filter @lifeboat/scripts rescue-setup && pnpm --filter @lifeboat/scripts rescue
pnpm --filter @lifeboat/scripts paymaster-guards
pnpm --filter @lifeboat/scripts helm lifeboatpq.eth   # any ENSv2 name on Sepolia
```

Scripts read `.env` (see `.env.example`). The WOTS+C secret seed lives in `secrets/` (gitignored).

## AI usage

See [docs/ai-usage.md](docs/ai-usage.md).

## Licence

MIT, see [LICENSE](LICENSE).
