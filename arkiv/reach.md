# Reach: who uses the registry, and can they try it today?

## Who
- **Holders** checking whether their key is already public, and getting a verified "aboard" record once they move.
- **DAO treasurers and security councils**: a multisig signer leaks their public key every time they sign, so "never sent a transaction" is no proof of safety. The registry records *how* exposure was found (`via`).
- **Wallet developers**: before sending to an address or ENS name, query `lifeboat.exposure.v1` / `lifeboat.name.v1` and warn. No API key, no account with us.
- **Post-quantum wallet teams** (any scheme): publish their accounts' leaf uses to the shared ledger, so a "signed twice" mistake is caught by anyone, not just the wallet that made it.
- **Researchers**: block-stamped exposure data by chain and by method.

## Can they try it today?
Yes. The README's query runs with Node and no Arkiv access key. The CLI (`pnpm --filter @lifeboat/scripts arkiv-query`) shows every Harbour view.

## Numbers (live, Rabdi)
- 12 entities in the first verified batch: 6 exposure attestations across 2 chains, 2 aboard records (a token-only wallet rescued with no ETH; an ENS name handed over), 1 name verdict, 3 leaf-ledger entries.
- Cost: 0.0032 tGLM for all 12.

## What we'll keep building after Mumbai
- Publish the discovery engine's public-infrastructure findings (bridges, security councils, DAO Safes) as exposure entities, refreshed daily.
- A watcher that reads the alt mempool and publishes leaf sightings for every WOTS-style account it sees.
- A wallet warning ("this name's controller key is public") through a Snap or browser extension that queries the registry.
- Mainnet ENSv2 Helm checks (ENSv2 is live on mainnet).
