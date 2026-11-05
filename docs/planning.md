# Planning summary (written before hacking started)

Before 5 Nov 2026, 21:00 IST we only researched and planned. No project code existed until then: see the first commit. This is a summary of that plan, so the AI-assisted planning is visible (see [ai-usage.md](ai-usage.md)).

## Problem

A future quantum computer can take over any wallet whose public key is on-chain, and every signature puts it there, not just sending a transaction. Multisig approvals, governance votes and off-chain orders publish signatures too. So many more keys are already exposed than "has this address sent a transaction?" suggests, including keys that control treasuries, bridges and ENS names.

## Plan

1. **Escape (EF, EIP-8141 frame transactions):** a post-quantum account that verifies a WOTS+C one-time signature inside a VERIFY frame, with one fresh Merkle leaf per signing attempt (fee bumps never reuse a key). A staked rescue paymaster sponsors gas for exposed wallets that hold tokens but no ETH; that needs the ERC-8421 alternative mempool.
2. **Keep the name (ENSv2, Sepolia):** a "Helm check" of every path that controls a name (owner, delegates, operators, resolver roles, parent registries), then a handover to the PQ account that the registry itself verifies.
3. **Publish (Arkiv + Swarm):** a public Q-Day registry of expiring exposure attestations, and a ledger of used one-time leaves. Evidence bundles go on Swarm.
4. **Sign safely (hardware):** a small signer with a counter that only goes forward, so a one-time key can't be used twice even after a reset.

## Build order (riskiest first)

1. Probe the devnet's frame opcodes.
2. WOTS+C in TypeScript with tests.
3. The Yul account; test vectors shared with TypeScript; gas measured.
4. Deploy and land a frame transaction through the alt mempool; save the evidence.
5. Rescue paymaster and the three-way admission demo.
6. ENSv2 Helm check and handover.
7. Arkiv registry and leaf ledger; Swarm evidence.
8. Hardware signer, UI, docs, video.

## Ground rules

- Every number in the docs comes from our own run or a cited source, block-stamped.
- No quantum computer can do this today: these are readiness findings from public data. We name public infrastructure only, never individuals.
- Security issues found in other projects are disclosed to them privately first.
