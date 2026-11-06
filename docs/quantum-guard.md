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

## Limits we're honest about
- **Modules bypass transaction guards in Safe 1.4.1** (`execTransactionFromModule`). A guarded Safe should have no modules, or use Safe 1.5's module guard.
- **Lose the PQ key and the Safe is locked:** the guard checks its own removal too. Keep the key on the hardware signer, and rotate before the 256 leaves run out.
- **Cost:** a co-signed transaction costs about 50k gas for the check plus the 2,336-byte witness in calldata. That's fine for treasury operations, but not something to run per trade.
- **Credit:** the co-signer guard pattern comes from Safe Research. What's new here is a hash-based co-signer with on-chain one-time-key accounting, plus covering the ERC-1271 path.

## Run it
```bash
pnpm --filter @lifeboat/scripts gen-guard-vectors && (cd contracts && forge test --match-contract QuantumGuard)
pnpm --filter @lifeboat/scripts quantum-guard     # needs .env (DEV_PRIVATE_KEY) and a little Sepolia ETH
```
