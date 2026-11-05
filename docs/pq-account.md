# LifeboatAccount: a post-quantum account on EIP-8141 frame transactions

## What it is

A smart account whose only key is a **hash-based one-time signature scheme (WOTS+C)** under a Merkle tree of 256 one-time leaves. It runs entirely in the VERIFY frame of an EIP-8141 frame transaction: no ECDSA, no relayer, no bundler contract. Written in Yul, 2,294 bytes.

- Code: [`contracts/yul/LifeboatAccount.yul.tmpl`](../contracts/yul/LifeboatAccount.yul.tmpl) + the shared core [`wots_core.yul`](../contracts/yul/wots_core.yul) → generated [`yul/gen/LifeboatAccount.yul`](../contracts/yul/gen/LifeboatAccount.yul)
- Signer: [`packages/pq`](../packages/pq) (TypeScript)
- First live transaction: [`0xd999725a…6a0f8ef0`](https://explorer.altmempool.wtf/tx/0xd999725ac312ca2cccfcebfbae84e66560c6587f052af6aa919622fc6a0f8ef0?node=https%3A%2F%2Faltmempoolgateway.forshtat.com%2Frpc) (chain 1337, block 403,931, through the alt-mempool gateway)

## Design

| Choice | Value | Why |
|---|---|---|
| Hash | keccak256 (n = 32 bytes) | Native opcode: 30 + 6/word gas |
| Winternitz parameter | w = 16 (4-bit digits), 64 chains | Balances signature size against hashes |
| Checksum | **none: WOTS+C** fixed digit sum S = 560 | The signer grinds a counter until the digest digits sum to exactly 560 (709 tries on average, about a millisecond). Any other digest with the same sum has a smaller digit somewhere, so a signature can't be pushed forward into a forgery. The verifier then always does exactly 64·15 − 560 = **400 hashes** |
| Tweaks | `pubSeed[0:24] ‖ idx ‖ a ‖ b ‖ type ‖ 0` in every hash | Domain separation per leaf, chain, step and tree node (multi-target protection) |
| Tree | height 8 = 256 leaves, **index-bound** | The leaf index chooses left/right *and* is in every node tweak, so a path can't be replayed at another index |
| Witness | 2,336 bytes: header (leaf, counter) + 64 chain values + 8 siblings | Carried in an **ARBITRARY signature entry**, exact length enforced (`SIGPARAM 0x03`), so a relayer can't pad it |
| Message | `keccak(tweak ‖ root ‖ sigHash ‖ counter)` with `sigHash = TXPARAM 0x08` | Binds the signature to this key and this exact transaction |

### Dispatch (on CALLER)
- `0xaa` (frame entry point) → **VERIFY**:
  1. Read the witness with `SIGDATACOPY`.
  2. Check that the leaf is at or above the on-chain leaf floor.
  3. Verify the WOTS+C signature and the Merkle path.
  4. `APPROVE(scope)`, where the scope comes from the signed VERIFY frame data.
- the account itself → **execute** (SENDER frames): `leaf ‖ to ‖ value ‖ calldata`. It raises the **leaf floor** past the leaf this transaction used, then makes the call.
- anyone else → accept ETH.

## One-time keys and fee bumps (the security edge)

A WOTS key that signs two different messages leaks enough for forgeries. The EIP-8141 sigHash covers the `fees` field, so **every fee bump is a new message and needs a new signature**. A wallet that "re-signs with the same key" when bumping fees breaks its own security. (This is known in the hash-based-signature community; we credit it, we don't claim it.)

What Lifeboat does about it:
1. **Fresh leaf per signing attempt.** The leaf is reserved and **written to disk before the signature leaves the process** ([`scripts/src/lib/pqkey.ts`](../scripts/src/lib/pqkey.ts)). A crash can't cause reuse.
2. **On-chain leaf floor.** Every landed transaction raises `slot 2` past its leaf, and VERIFY rejects any leaf below the floor. So even if an old leaf *was* signed twice somewhere, a forgery with it can't pass VERIFY after the next transaction lands. Checked on-chain after the first transaction: the floor moved from 1 to 3.
3. "Leaf = nonce" is wrong: a fee bump with a new leaf would then look like a second transaction, not a replacement. The nonce stays the replacement key.

## Gas (measured)

| What | Gas | Source |
|---|---|---|
| WOTS+C core (digest, sum check, 400 chain hashes, leaf hash, 8 Merkle levels) | **44,870**, constant for every valid signature | Foundry, [`test/Wots.t.sol`](../contracts/test/Wots.t.sol) |
| Same core with plain loops (before unrolling) | 68,256 | Foundry |
| Whole VERIFY frame on the devnet (SIGPARAM, SIGDATACOPY, 3 SLOADs, core, APPROVE) | **52,369** used of 60,000 declared | `ethrex_simulateFrameTransaction`, [`evidence/ef/frame-demo-leaf1.json`](../evidence/ef/frame-demo-leaf1.json) |
| Whole transaction (incl. 2,336-byte calldata floor and the transfer) | 168,954 | receipt |
| Deploy (CREATE2, 2,294 bytes) | 4,090,558 | receipt (state gas is 1,530/byte on this devnet) |

**How we got from 68k to 45k:** the generator ([`tools/gen-yul.mjs`](../tools/gen-yul.mjs)) unrolls each chain walk into straight-line code behind a 4-level decision tree on the digit (each step costs one `MSTORE8` of the step index into the tweak, then `MSTORE(0x20, KECCAK256(0, 0x40))`). The digit sum is computed with SWAR (nibbles → bytes → 16-bit lanes → one multiply) instead of a 64-step loop.

**Headroom:** with 60k declared for the account, a sponsor's VERIFY has about 40k left under the 100k prefix cap the live sidecar enforces. Our rescue paymaster uses 22.7k ([rescue-paymaster.md](rescue-paymaster.md)).

## Tests

- TypeScript: 13 tests (round trips, every tamper case, index binding, the fixed-sum property, grind cost).
- Yul: 15 TypeScript-generated vectors (6 valid, 9 tampered) through a harness that compiles **the same core** as the account; constant-gas check; constructor, leaf floor and dispatch tests on the account itself.

## Trade-offs and alternatives

| Scheme | Signature | Verify gas (rough) | Stateful? | Notes |
|---|---|---|---|---|
| **WOTS+C + Merkle (ours)** | 2.3 KB | ~45k | yes: 256 uses per key | Simple, constant cost, needs careful leaf state (we enforce it on-chain) |
| XMSS / XMSS^MT | 2.5–5 KB | higher (WOTS+ with checksum chains, variable cost) | yes | Standardised (RFC 8391); variable verify cost makes tight gas limits harder |
| SPHINCS+ / SLH-DSA, leanSPHINCS | 8–17 KB (smaller variants exist) | 100k–1M+ | no | Stateless is a big UX win; leanSPHINCS is the EF's direction. A LifeboatAccount could switch its verifier to it, and the rescue flow doesn't change |
| Falcon / ML-DSA | 0.7–2.4 KB | high without precompiles | no | Lattice math is expensive in the EVM today |

**Limits we're honest about:**
- 256 signatures per key, so the account needs a key rotation (planned: a SENDER-frame `setRoot`).
- Leaf state lives on the signing device and on-chain; the hardware signer (`docs/hardware.md`) adds a counter that can't go backwards.
- The demo uses devnet ETH and mock USDC.
