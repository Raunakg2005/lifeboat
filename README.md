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

## Parts

| Part | Folder | Status |
|---|---|---|
| WOTS+C post-quantum signatures (TypeScript) | `packages/pq` | done: 13 tests |
| PQ account on EIP-8141 frame transactions (Yul) | `contracts` | done: 9 Foundry tests against TypeScript vectors |
| Devnet scripts (deploy, sign, dry-run, submit, capture evidence) | `scripts` | done |

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
```

Scripts read `.env` (see `.env.example`). The WOTS+C secret seed lives in `secrets/` (gitignored).

## AI usage

See [docs/ai-usage.md](docs/ai-usage.md).

## Licence

MIT, see [LICENSE](LICENSE).
