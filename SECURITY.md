# Security

## What Lifeboat claims, and what it doesn't

**No quantum computer can break secp256k1 today.** Everything Lifeboat reports is *readiness* data from public on-chain information: "this key's public key is already on-chain, so a large enough quantum computer could derive its private key". We never say a wallet "can be drained today".

- **Exposure is a lower bound.** We count keys revealed by transactions (nonce > 0 on the chains we check) and by Safe signatures we can decode. Keys revealed elsewhere (other chains, other signing systems) can make the real picture worse, never better.
- **"Takeover-able on Q-Day"** for a multisig means its threshold of signer keys is already public. It doesn't account for timelocks, guards or modules. For contracts, it means takeable through the upgrade or admin path, not a proven drain.
- **Helm check:** "protected" means no *exposed* key holds paths 1–4 at that block, **and** the role lists were proven complete against the on-chain `roleCount`. If completeness can't be proven, the verdict is "unknown", never "protected". Path 5 (parent registries) is systemic and outside the owner's control.

## Responsible handling
- We name **public infrastructure only** (security councils, protocol multisigs, bridges). Individuals are counted, never named; signer addresses are truncated in the UI.
- Implementation concerns we found in *other* projects are being **disclosed privately to those teams first** and are deliberately not in this repo, the demo or the slides.

## The WOTS+C account and wallet
- **One-time keys must never sign twice.** Reusing a leaf leaks chain values; we measured the forgery cost at our parameters: 2 reuses ≈ 2^64 tries, 5 ≈ 2^32 (GPU range), 12 ≈ 2^18 (a laptop, seconds). The live forgery demo on chain 1337 shows it end to end ([docs/pq-account.md](docs/pq-account.md)).
- **Defences:**
  1. **Fresh leaf per signing attempt** (including fee bumps), reserved and **written to disk before** any signature leaves the signer (`scripts/src/lib/pqkey.ts`). The ESP32 firmware persists its counter before computing the chains.
  2. **An on-chain leaf floor** (EIP-8141 account) and a **used-leaf bitmap** (Sepolia wallet), so an old leaf can't pass verification once a transaction with it has landed.
  3. An exact witness length (no padding malleability), witness leaf bound to the leaf marked used, and an index-bound Merkle tree (no sorted-pair proofs).
  4. ERC-1271 through **approved hashes only**: a WOTS key never signs off-chain messages.
- **Leaf ledger:** every use of a leaf can be published to Arkiv by anyone. Two different digests for one leaf raise "signed twice".

## Rescue paymaster
- It pays only for registered accounts, under a max-cost cap, and only if the **very next frame** repays it in the token: not batched (so it can't be undone), to the paymaster, at least the fee. Five attack variants are refused in dry-runs ([docs/rescue-paymaster.md](docs/rescue-paymaster.md)).
- Owner functions are owner-only; staking and unstaking go through `exec`.

## Secrets in this repo
- `.env` and `secrets/` are gitignored. A pre-commit hook (`.githooks/pre-commit` → `tools/check-secrets.mjs`) blocks any staged file containing a `.env` secret value, a WOTS seed or a throwaway key from `secrets/`, or a private-key assignment. Every commit in this repo passed it.
- The web app is a static site with no secrets. It reads Arkiv without a key; any `VITE_` value is public by definition.
- The deployed site sends a strict CSP: scripts only from itself; connections only to the RPCs, Arkiv and gateways it uses; no framing.
- Devnet keys are dev-only; the devnet operator's published key is never used.

## Reporting
Please report security issues privately to the repository owner rather than in a public issue.
