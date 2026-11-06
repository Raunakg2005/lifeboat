# Reach: who uses the registry, and can they try it today?

## Who it's for
- **Holders** checking whether their key is already public, and getting a verified "aboard" record once they move.
- **DAO treasurers and security councils.** A multisig signer reveals their public key every time they sign, so "never sent a transaction" is no proof of safety. The registry records *how* exposure was found (`via`). Our council scan found that every signer key is public for the Arbitrum (12/12) and Optimism (13/13) security councils, and those Safes are in the registry and on the Monitor.
- **Wallet developers.** Before sending to an address or an ENS name, query `lifeboat.exposure.v1` / `lifeboat.name.v1` and warn. No API key, no account with us.
- **Post-quantum wallet teams** (any scheme). Publish their accounts' leaf uses to the shared ledger, so a "signed twice" mistake is caught by anyone, not just the wallet that made it.
- **Researchers:** block-stamped exposure data by chain and by method, with the full evidence on Swarm.

## Can they try it today?
Yes:
- **In the browser:** https://lifeboat-mu.vercel.app → **Harbour** (the registry, the ledger, the Monitor), or **Check** any address or ENS name to see its registry record. Every row links to the Arkiv explorer and, where there's evidence, opens and verifies the Swarm file.
- **From a terminal, with no key and no `.env`:** `pnpm install && node scripts/arkiv-query-public.mjs` prints the exposed keys and runs the "signed twice" check on the ledger.
- **The full CLI:** `pnpm --filter @lifeboat/scripts arkiv-query`.

## Numbers (live on Rabdi, 6 Nov 2026)
- **Exposure:** 9 keys with a current reading (13 readings on Arkiv, older ones expiring), across Ethereum, Sepolia and the EIP-8141 devnet. Among them are 4 council or multisig Safes. For 3 of them, the signing threshold can already be met with public keys (Monitor alerts).
- **Aboard:** 2 verified moves to post-quantum accounts: a token-only wallet rescued with no ETH, and an ENS name handed over. Each has a readonly record with its evidence on Swarm.
- **Names:** 2 ENSv2 verdicts on our own test names.
- **Ledger:** 34 one-time-key sightings, including our naive test wallet's leaf 0 seen signing 17 different messages, so the ledger flags it as signed twice.
- **Monitor:** 6 watched targets, 4 high-severity alerts.
- **Cost:** the first verified batch wrote 12 entities for 0.0032 tGLM.

All of these are our own publisher's records; nobody outside the team has written to the registry yet.

## What we'll keep building after Mumbai
See the [roadmap](../docs/roadmap.md) and the [business model](../docs/business-model.md). For Arkiv in particular:
- Publish the discovery engine's public-infrastructure findings (bridges, security councils, DAO Safes) daily, as records updated in place.
- A watcher that reads the alt mempool and publishes leaf sightings for every WOTS-style account it sees: the first writer that isn't us.
- A wallet warning ("this name's controller key is public") through a Snap or browser extension that queries the registry.
- Mainnet ENSv2 Helm checks (ENSv2 is live on mainnet).
