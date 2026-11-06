# Quantum Guard: protect a Safe without moving funds

**The problem:** a security council or DAO treasury can't just move its funds to a new account. Its Safe holds upgrade rights, roles and integrations. On Q-Day an attacker who forges enough owners' ECDSA signatures controls the Safe outright.

**Quantum Guard adds one more signer that a quantum computer can't forge.** It's a WOTS+C key: hash-based, checked by the same Yul verifier as Lifeboat's EIP-8141 account. The owners keep signing as they do today.

Code: [`contracts/src/QuantumGuard.sol`](../contracts/src/QuantumGuard.sol) · tests: [`contracts/test/QuantumGuard.t.sol`](../contracts/test/QuantumGuard.t.sol) (9, with real signatures from the TypeScript signer) · live run: [`scripts/src/quantum-guard.ts`](../scripts/src/quantum-guard.ts) · evidence: [`evidence/guard/quantum-guard.json`](../evidence/guard/quantum-guard.json)

## How it works
One contract per Safe, installed in two roles.

1. **Transaction guard** (`setGuard`).
   - Safe 1.4.1 calls `checkTransaction` on every `execTransaction`, after the owners' signatures check out.
   - The guard requires a 2,336-byte WOTS+C witness **appended after the owners' signatures**, signed over that exact `safeTxHash`.
   - The witness's one-time leaf is spent in a bitmap **before** the signature is verified. A reused leaf is refused, and a reverted call rolls the mark back.
2. **Signature handler** (`setFallbackHandler`).
   - Safe "signatures" for off-chain messages (ERC-1271: Permit2 permits, CoW orders, Seaport) never pass through a transaction guard. With Safe's standard handler, forged owner signatures alone would make them valid.
   - With Quantum Guard as the handler, a message is valid only if the **PQ key approved it** (`approveMessage`, which anyone can relay) **and** the owners signed it.
3. **Key rotation.** After 256 signatures the PQ key is rotated with a signature from the current key (`rotate`).

What the PQ key signs: `keccak256(abi.encode("LIFEBOAT_QUANTUM_GUARD_V1", kind, chainId, guard, safe, hash))`, where kind is 0 for a transaction, 1 for a message and 2 for a rotation. A signature can't be replayed across kinds, guards, Safes or chains.

## Live on a real Safe 1.4.1 (Sepolia, 6 Nov 2026)
Safe [`0x94E8…51B8`](https://sepolia.etherscan.io/address/0x94E8Da267c6356B8f5D292e6668252b79c3951B8) (1-of-1, the owner is an EOA whose key is already public) · guard [`0xcba2…e55af`](https://sepolia.etherscan.io/address/0xcba2dc40f216ed382994917add851a1a7f7e55af)

| Step | Result | Tx |
|---|---|---|
| Before: ERC-1271 with the owner's signature alone | **valid** (`0x1626ba7e`): a forged owner key could sign a permit | — |
| Install the guard (owners only: nothing guards yet) | ✅ block 12,074,459 | [`0xb409…6f48`](https://sepolia.etherscan.io/tx/0xb40960a485ae484c41c37dcf9594b2bb892db52d8f1dfe5520bdae0be7646f48) |
| Make it the signature handler: the first co-signed transaction (leaf 0) | ✅ block 12,074,460, 289,929 gas | [`0x0908…1b5a`](https://sepolia.etherscan.io/tx/0x0908727714855bf5b0833073e7442c7439774eccffcb19bc26111a95803c1b5a) |
| **Attack: pay an attacker with the owner's ECDSA signature only** | ❌ **refused on-chain** (`MissingPQSignature`), block 12,074,461 | [`0x41b4…8b68`](https://sepolia.etherscan.io/tx/0x41b45516e0cb13c9c8c72f65542b48fb486b728d50aee0d0b332554eb7698b68) |
| The same kind of payment, co-signed (leaf 1) | ✅ block 12,074,462, 195,480 gas | [`0x1562…1118`](https://sepolia.etherscan.io/tx/0x15628aced1bbd2c90c59d3feca242a23a41d182386b9eecf0493a731c1f21118) |
| ERC-1271 with the guard as handler, owner's signature alone | **refused** (`0xffffffff`) | — |
| The PQ key approves that message (leaf 2), relayed by anyone | ✅ block 12,074,465 | [`0xf1ca…9a51`](https://sepolia.etherscan.io/tx/0xf1caeb757568e1caaecce8012ae00eda292b43c2031b4570238276b81b829a51) |
| ERC-1271 after the approval, owner's signature | **valid** | — |

Each leaf was reserved and saved to disk before it signed. Three of 256 are used.

## Tests (Foundry, real WOTS+C signatures)
The tests use a minimal Safe with Safe 1.4.1's order of checks in `execTransaction`: owners checked, nonce moves on, then the guard.
- **Interface:** the guard interface id equals Safe 1.4.1's `0xe6d7a83a`, so `setGuard` accepts it (the live run confirms this on the real Safe).
- **Transactions:** ECDSA alone is refused. A co-signed transaction runs. A co-signature for "pay 0xbeef" can't pay anyone else. A reused leaf is refused. The next leaf works. Only the Safe can call `checkTransaction`.
- **ERC-1271:** refused with the owners' signatures alone, and valid after the PQ approval. Asked directly instead of through the Safe, it's refused.
- **Rotation:** the new key works, and the old one stops co-signing.

## v2: lost-key recovery, a factory, a one-transaction install
- **Lost-key recovery.**
  - The owners alone start a recovery with a Safe transaction to the guard. The guard lets exactly `startRecovery()` and `finishRecovery()` through without the PQ signature.
  - It completes after a timelock (7 days by default).
  - Until then, the PQ key can **veto** it (`cancelRecovery`, relayed by anyone).
  - A quantum attacker with forged owner keys could start one too. That's why the [Monitor](monitor.md) alerts on `RecoveryStarted`.
  - Only a real Safe transaction can call these: a call that reaches the guard through the Safe's fallback carries the caller appended, and is refused.
- **Factory** (`QuantumGuardFactory`): deploys a guard for any Safe at a CREATE2 address the app can predict.
- **One-transaction install:** the Safe delegatecalls Safe's `MultiSendCallOnly` to call `setGuard` and `setFallbackHandler` together.
- **The app** (Protect tab): install on any Sepolia Safe, co-sign payments with a browser WOTS+C key (testnet only), and start, finish or veto a recovery. Safes with several owners collect confirmations through Safe's transaction service.
- **End-to-end test** (`pnpm --filter @lifeboat/scripts e2e-protect`): a throwaway test wallet is injected into the real page; it connects, creates the browser key, installs the guard on a fresh Safe, co-signs a payment, starts a recovery and vetoes it, then checks the chain (guard and handler set, root matches the browser key, 2 leaves used, no recovery pending). Last run passed on Safe [`0x8eD9…71a9`](https://sepolia.etherscan.io/address/0x8eD9F14385dE79C855d4D283028F98C0b4B771a9); transactions and screenshots in [`evidence/e2e/`](../evidence/e2e/).

### Live on a fresh Safe 1.4.1 (Sepolia, timelock 2 minutes for the run)
Safe [`0x14B3…9526`](https://sepolia.etherscan.io/address/0x14B3beE066Ba36e01ea04f43EA9b5E19b8219526) · guard [`0xd7a6…D502`](https://sepolia.etherscan.io/address/0xd7a6403A4BBc19db6dc022ee8200c43c264DD502) · factory [`0x2f4f…0fb7`](https://sepolia.etherscan.io/address/0x2f4f0a857438ddd5f473ae93176d0d66a03b0fb7)

| Step | Tx |
|---|---|
| Factory deploys the Safe's guard | [block 12,074,827](https://sepolia.etherscan.io/tx/0x5b8cdf1eddf68e2d470b2f62b34b170f21834ce4a19c55046e7f6587bce82a63) |
| **Install: setGuard + setFallbackHandler in one Safe transaction** | [block 12,074,828](https://sepolia.etherscan.io/tx/0xd471e184c40e38b784f80e1d71476dcb14a3cb25a6b33864a07e6b98a682221d) |
| A co-signed payment | [block 12,074,849](https://sepolia.etherscan.io/tx/0x00d0cc514e3b762889fe18caa009ff320030f706b862fbb1f13c5ea1b5c15b36) |
| The owners start a recovery (what a quantum attacker could do) | [block 12,074,850](https://sepolia.etherscan.io/tx/0xf35e5073088314d2efa2d22a61298429508a978e3ebb00921ccc2d1202adde12) |
| **The PQ key vetoes it** | [block 12,074,851](https://sepolia.etherscan.io/tx/0x1aeee025c6e911be6759976a1cdb7648a0dfc13c09091db487309b928a6ea37b) |
| The owners start another (the key is "lost"); finishing early is refused with `RecoveryNotReady` | [block 12,074,853](https://sepolia.etherscan.io/tx/0x5e69d7bbb640e5c4a7328c7efb9c0aaf7d1c4bdc1a538f363e84615841340123) |
| **Recovery completes after the timelock** | [block 12,074,867](https://sepolia.etherscan.io/tx/0x858f35e1d0a9e4f4c7fd97738219467e247a1e2eeea376a076bdbf16aa1141f3) |
| The owners act alone afterwards | [block 12,074,873](https://sepolia.etherscan.io/tx/0x694281b79fc97a5214a6fc013fbb70755c83e5c30df250fe5161e8da45b24857) |

Raw: [`evidence/guard/lifecycle.json`](../evidence/guard/lifecycle.json). Some steps were re-run after a load-balanced RPC answered from a stale node. The scripts now take the nonce and recovery data from receipts, and set gas explicitly.

## Limits we're honest about
- **Modules bypass transaction guards in Safe 1.4.1** (`execTransactionFromModule`). A guarded Safe should have no modules, or use Safe 1.5's module guard.
- **Lost PQ key:** v1 had no way back. v2 adds the timelocked recovery, which the PQ key can veto. Someone must watch for `RecoveryStarted` (the Monitor does).
- **Cost:** a co-signed transaction costs about 50k gas for the check plus the 2,336-byte witness in calldata. That's fine for treasury operations, but not something to run per trade.
- **Credit:** the co-signer guard pattern comes from Safe Research. What's new here is a hash-based co-signer with on-chain one-time-key accounting, plus covering the ERC-1271 path.

## Run it
```bash
pnpm --filter @lifeboat/scripts gen-guard-vectors && (cd contracts && forge test --match-contract QuantumGuard)
pnpm --filter @lifeboat/scripts quantum-guard     # needs .env (DEV_PRIVATE_KEY) and a little Sepolia ETH
```
