# Why Arkiv (and not our own database)

## What users would lose with Postgres
1. **Trust in the writer.**
   - A quantum-readiness list run by a wallet company is a list that company can quietly edit. On Arkiv every record is signed by its writer (`$owner`).
   - The app shows only records our publisher signed. Anyone can check a record in one click ("on Arkiv ↗").
   - The audit trail (`aboard`, `leaf`) is **readonly**: not even we can change it, and the app reads that flag from the chain.
2. **The leaf ledger only works if anyone can write to it.**
   - A one-time key is dangerous the moment it signs twice *anywhere*: a mempool, a dry run, another wallet app.
   - A watcher that sees a leaf must be able to publish that sighting without asking us. With a private database there's no permissionless writer, so the "signed twice" alert would only ever see our own data.
   - So far every one of the 34 sightings was written by our publisher. The ledger accepts any writer, and Harbour shows who reported each one.
3. **Anyone can keep the evidence alive.** `permissionlessExtension` lets a DAO, an auditor or the user extend an `aboard` record they rely on, even if Lifeboat disappears. Nobody outside the team has needed to yet; the flag is there for when we're not.
4. **Freshness is built in.** Exposure is a reading at a block. Expiry gives every reading a 24-hour life with no cleanup job, and the app shows "expires in …". A re-check patches and extends the same record, so its link keeps working.
5. **No API to beg for.**
   - Any wallet can query the registry directly (indexed `status`, `address`, `name`, `severity`…) with no account with us and no Arkiv key.
   - The README query runs with Node alone.
   - Wallet teams can build "this name's controller key is public" warnings without a partnership.
6. **Evidence that checks itself.** Records carry `swarmRef` plus `evidenceHash`, and the app re-hashes the Swarm file in the browser. Postgres plus S3 would ask readers to trust both of us.

## What we kept off Arkiv, and why
- **Secrets:** WOTS+C seeds, throwaway keys and the publisher key never leave `secrets/` or `.env`. The hardware signer's seed never leaves the ESP32.
- **The Monitor's private side:** a team's webhook URL, and the Monitor's dedup state (`scripts/.monitor-state.json`). Alerts go to Arkiv; where they're delivered privately doesn't.
- **Private scans:** a user checking 25 addresses in the app may not want them public. Checks run in the browser and publish nothing.
- **Individuals:** we count exposed individuals in aggregate stats (the ENS survey publishes counts only). Per-address entries are only for public infrastructure (council Safes) and our own test accounts, labelled as ours.
- **Private disclosures:** they go to the affected teams directly, never to Arkiv or Swarm.
- **Big files:** full reports go to Swarm; Arkiv holds the reference and the hash.
