# Hidden exposure: keys a nonce check never sees

**The usual rule:** an address's public key is on-chain once it has sent a transaction (nonce > 0). Every quantum-readiness checker we know of uses only that.

**The gap:** a multisig signer publishes its public key **every time it signs**, even if it has never sent a transaction itself. The signature sits in the Safe's `execTransaction` calldata, and anyone can recover the public key from it.

## Method ([`packages/core/src/safe-scan.ts`](../packages/core/src/safe-scan.ts))
1. Read `getOwners()` and `getThreshold()` at a pinned block.
2. Check every owner's nonce on Ethereum, Base, Arbitrum, Optimism and Polygon (the nonce baseline).
3. Fetch the Safe's `ExecutionSuccess` logs over the full range (Tenderly's public mainnet gateway). In Safe ≤ 1.3 the `safeTxHash` is in the log data; from 1.4 it's `topics[1]`.
4. For each execution that called the Safe directly with `execTransaction`, decode the `signatures` bytes into 65-byte entries:
   - `v = 27/28`: `ecrecover(safeTxHash)`
   - `v > 30`: `eth_sign` (EIP-191 hash, v − 4)
   - `v = 0`: contract signature
   - `v = 1`: approved hash
   We recover the address **and the public key**.
5. An owner that is itself a Safe is scanned one level down. It counts as taken over if its own threshold of keys is public.
6. **Takeover-able on Q-Day** = public keys ≥ threshold.

Executions routed through other contracts (about 1–4% here) are skipped, so the result is a **lower bound**.

## Results: security councils and protocol multisigs, Ethereum mainnet, block 26,350,495 (re-scanned at blocks 26,351,153–156 before publishing: same numbers)
Raw: [`evidence/discovery/councils.json`](../evidence/discovery/councils.json). The app's Discover tab can re-run it live in the browser, and the Scan tab deep-scans **any Safe on Ethereum mainnet** the same way: paste its address (or pick Safe mode) and it reports public keys by nonce vs counting signatures, the threshold, nested Safes, and one checkable proof. It runs in the browser and publishes nothing.

| Safe (public infrastructure) | Rule | Public keys by nonce | Counting signatures | Takeover-able on Q-Day |
|---|---|---|---|---|
| **Optimism Security Council** `0xc281…Bd03` | 10 of 13 | 4 | **13** | no → **yes** |
| **Base 2-of-2** `0x7bB4…595c` (owned by two Safes) | 2 of 2 | 1 | **2** | no → **yes** |
| ↳ nested council `0x20Ac…A4Dd` | 8 of 11 | **0** | **11** | no → **yes** |
| ↳ nested Safe `0x9855…46A1` | 3 of 6 | 4 | 6 | yes → yes |
| Arbitrum Security Council (L1) `0xF06E…3F85` | 9 of 12 | 11 | 12 | yes → yes |

**Takeaway:** two of the four top-level Safes look safe by nonce and aren't. Base's nested 8-of-11 council has **zero** keys exposed by nonce and **all 11** exposed by signatures.

## Framing
No quantum computer can do this today. This is readiness data: "the upgrade path is controlled by keys whose public keys are already on-chain". We name public infrastructure only and truncate individual signer addresses. The fix that needs no fund movement is a post-quantum co-signer on these Safes; Lifeboat's PQ account and leaf ledger are the building blocks.

## Pre-event research, for comparison
Before the event we ran a wider read-only study (top-1,000 ETH holders, 26 DAO and protocol Safes, the admin paths of the biggest contracts). This repo re-derives the council results from scratch with new code and claims only what it re-measured above. The wider study isn't re-run here.
