# Why Arkiv (and not our own database)

**What users would lose with Postgres:**

1. **Trust in the writer.** A quantum-readiness list run by a wallet company is a list that company can quietly edit. On Arkiv, every attestation is signed by its writer (`$owner` = "vouched by"), and audit-trail entities (`aboard`, `leaf`) are **readonly**: not even we can change them.
2. **The leaf ledger only works if anyone can write to it.** A one-time key is dangerous the moment it signs twice *anywhere*, including a mempool, a dry-run or another wallet app. A watcher that sees a leaf must be able to publish that sighting without asking us. With a private database there's no permissionless writer, so the "signed twice" alert would only ever see our own data.
3. **Anyone can keep the evidence alive.** `permissionlessExtension` lets a DAO, an auditor or the user extend an `aboard` record they rely on, even if Lifeboat disappears.
4. **Freshness is built in.** Exposure is a reading at a block. Expiry gives every attestation a lifetime (24 h) without a cleanup job, and the UI shows the countdown.
5. **No API to beg for.** Any wallet can query the registry directly (indexed `status`, `address`, `verdict`…) without an account with us. The README's query runs without even an Arkiv access key.

**What we kept off Arkiv, and why:**
- **Secrets:** WOTS+C seeds and throwaway keys never leave `secrets/`.
- **Private fleet scans:** a user checking 25 addresses may not want them public, so publishing is opt-in. Public entries are aggregates and opt-in individuals.
- **Big files:** full Helm reports and transaction evidence go to Swarm; Arkiv stores the `swarmRef`.
- **Individuals we discover:** we count exposed individuals in aggregate stats but publish per-address entries only for public infrastructure, or for users who opt in.
