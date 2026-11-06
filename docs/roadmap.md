# Roadmap: from hackathon to production

**Principle:** everything that can be built and proven on testnets is done there first. Nothing is deployed or sent on mainnet before an external audit. Mainnet is only read: the Safe scans and the council findings.

## Done on testnet (6 Nov 2026)

| Area | What works now | Where |
|---|---|---|
| **Reliable reads** | Fallback RPC pools per job (Sepolia, mainnet, full-range logs); log queries split themselves when a backup node caps the range; reads batched through Multicall3 | `packages/core/src/ens.ts` (`RPCS`, `rpcTransport`) |
| **Quantum Guard v2** | A post-quantum co-signer for any Safe: transaction guard + ERC-1271 handler, a one-time-leaf bitmap, key rotation, **lost-key recovery** (owners start it, timelock, the PQ key can veto), a **factory** with predictable addresses, a **one-transaction install** | `contracts/src/QuantumGuard*.sol`, 13 Foundry tests, [quantum-guard.md](quantum-guard.md) |
| **Full lifecycle, live** | On a fresh Safe 1.4.1 on Sepolia: install in one transaction, co-signed payments, the owners' recovery vetoed by the PQ key, a recovery completed after the timelock, the owners acting alone afterwards | `evidence/guard/lifecycle.json` |
| **Protect a Safe (app)** | Connect a wallet, load any Sepolia Safe, see its guard, leaves and recovery state; install Quantum Guard; send a co-signed payment; start, finish or veto a recovery. One-owner Safes execute in place; multi-owner Safes go through Safe's transaction service (owners confirm in Safe{Wallet}, Lifeboat adds the PQ signature and executes) | App → Protect |
| **Monitor** | Watch list and alerts on Arkiv; a worker re-checks Safes, Quantum Guards and names; risky states on first sight, changes later, deduplicated; optional private webhook | `scripts/src/monitor.ts`, [monitor.md](monitor.md), App → Harbour |
| **Signer safety** | Before choosing a leaf, every signer syncs with the chain (the account's leaf floor, a guard's or wallet's bitmap), so a restored or copied key file never re-signs with a spent leaf | `scripts/src/lib/pqkey.ts` (`syncWithChain`), the Protect page |
| **Fair data** | ENSv2 survey of real names (one per owner, ours excluded, totals only); no prefilled inputs; live suggestions | `scripts/src/ens-survey.ts` |

## Still to do before mainnet

| Track | What | Why it waits |
|---|---|---|
| **External audit** | Quantum Guard + factory, then the PQ account | Contracts that hold control of treasuries need an independent review (2–4 weeks at the auditor, about $40–100k) |
| **Key custody** | The guard's PQ key on a hardware signer (ESP32 today, the Dabao with Crossbar next) or an HSM, with an encrypted backup | A browser key is fine on testnet, not for a council |
| **Data platform** | Paid RPC providers, an indexer for Safe executions and ENS events, Postgres for private team data (watch lists, webhooks, emails, API keys), an API with keys and rate limits | Private data never goes on a public chain; free endpoints rate-limit |
| **Coverage** | Mainnet ENS (v1 registry, NameWrapper, resolver approvals), Safes on L2s, Snapshot and CoW signatures | Read-only work, next after the platform |
| **Safe 1.5** | A module guard, so modules can't bypass the PQ co-signature | Safe 1.4.1 modules skip transaction guards |
| **Protocol-gated** | The EIP-8141 PQ account and the staked rescue paymaster on mainnet | They need EIP-8141 frame transactions on mainnet |

**Rough calendar with 2–3 engineers:**
- **Weeks 1–3:** the data platform.
- **Weeks 3–10:** product and coverage; Quantum Guard pilots with 1–2 councils on Sepolia.
- **Weeks 10–16:** audit, fixes, then mainnet with value caps and a bug bounty.
- **Later:** the PQ account and the rescue paymaster ship with the EIP-8141 fork.
