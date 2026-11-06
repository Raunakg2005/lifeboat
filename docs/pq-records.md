# Draft ENSIP: `pq.*` text records (post-quantum readiness)

**Status:** draft by the Lifeboat team, ETHGlobal Mumbai 2026. We found no existing proposal for this.

## Abstract
A small set of text records that say whether a name is controlled by quantum-safe keys, where its post-quantum account is, and when that was last checked. Wallets can warn before sending to a name whose controllers are exposed.

## Motivation
A future quantum computer can derive a private key from any public key already on-chain, and every signature puts one there. In ENSv2, control of a name is spread over its owner, delegates, operators, resolver role holders and parent registries ([helm-check.md](helm-check.md)). If any of those is exposed on Q-Day, the attacker can redirect the name, and every payment to it. Senders have no standard way to see this today.

## Records

| Key | Value | Example |
|---|---|---|
| `pq.status` | `protected` \| `exposed` \| `migrating` | `protected` |
| `pq.scheme` | the signature scheme of the controlling account | `WOTS+C-keccak-w16-S560-h8` |
| `pq.root` | the scheme's public key commitment (e.g. Merkle root), hex | `0x66e6…c015` |
| `pq.account` | the post-quantum account that controls the name | `0x2e58…997f` |
| `pq.checked` | ISO-8601 time of the last Helm check (optionally who signed it) | `2026-11-05T16:24:03Z signed by the PQ key` |
| `pq.ledger` | optional: where the account's used one-time leaves are published (e.g. an Arkiv query) | `arkiv:lifeboat.leaf?account=0x2e58…` |

## Wallet behaviour (recommended)
- Before sending to a name, read `pq.status`. If it's `exposed`, or if a Helm check of the name finds an exposed controller, show a warning.
- **Don't trust `pq.status` alone:** the records are only as safe as the resolver's role holders. A careful wallet re-runs the Helm check, or at least checks that the resolver's role holders and the name's owner match `pq.account`.
- `pq.checked` older than about 30 days should count as unknown.

## Security considerations
- Records written by an exposed key prove nothing. The live demo writes `pq.checked` **from the PQ account itself**, with a hash-based signature.
- Setting records at resolver `initialize` lets a relayer deploy the resolver and the first records without the PQ account spending a one-time key. The relayer must hold no roles afterwards (the handover script checks this).
- Least privilege for automated checkers: a watcher can be given a setter role for the single record `pq.checked` only, so a compromised watcher can change one timestamp and nothing else.

## Reference implementation
[`scripts/src/ens-handover.ts`](../scripts/src/ens-handover.ts) (writes the records), [`packages/core/src/helm.ts`](../packages/core/src/helm.ts) (checks control). Live on Sepolia: `lifeboatpq.eth`.
