# Monitor: alerts for Safes, Quantum Guards and names

A scan is a snapshot, and exposure only grows: every new signature can reveal another key. The Monitor re-checks what a team cares about and tells them when something changes.

Code: [`scripts/src/monitor.ts`](../scripts/src/monitor.ts) · targets: [`scripts/monitor.targets.json`](../scripts/monitor.targets.json) · schemas: `lifeboat.watch.v1`, `lifeboat.alert.v1` in [`packages/core/src/arkiv.ts`](../packages/core/src/arkiv.ts) · shown on the app's Harbour tab

## What it watches, and when it alerts
- **On the first check of a target**, it reports risky states it finds.
- **On every later check**, it reports changes.
- **Each alert is raised once** (the worker's state file deduplicates).

| Target | Alerts |
|---|---|
| **Safe** (Ethereum read-only, or Sepolia) | `threshold-reachable`: enough signer keys are public to reach the threshold (counting keys recovered from signatures, nested Safes included) · `keys-exposed`: more signer keys public than at the last check |
| **Quantum Guard** (a Sepolia Safe) | `recovery-started`: the owners started a lost-key recovery. **If it isn't you, veto it with the PQ key before the timelock ends.** A quantum attacker with forged owner keys would start exactly this · `recovered`: the guard no longer requires the PQ key · `guard-removed` / `guard-changed` / `no-guard` · `leaves-low`: 200+ of 256 one-time leaves used, so rotate the key |
| **ENS name** (Sepolia ENSv2) | `hijackable` on first sight · `verdict-changed` later |

## Where alerts go
- **Arkiv** (`lifeboat.alert.v1`, public, 30 days): anyone can read them without a key; the app's Harbour tab shows them. Watch entries (`lifeboat.watch.v1`) list what's watched.
- **A webhook** (Discord or Slack style), set as `MONITOR_WEBHOOK_URL` in `.env`. Delivery settings are private, so they never go on-chain.
- **stdout**, for logs.

**What's public:** the alert, the target address and the reason. Names of people and contact details never are.

## Live (6 Nov 2026)
- **First pass:** 6 targets got public watch entries and **4 alerts were written to Arkiv** in one batch (`0xe78f540b…b574e`):
  - three security councils past their threshold (Arbitrum 12/12, Optimism 13/13, Base 2/2, Ethereum read-only);
  - our v2 test Safe, whose guard was recovered.
- **Second pass:** no change, no new alerts.

## Run it
```bash
pnpm --filter @lifeboat/scripts monitor              # one pass
pnpm --filter @lifeboat/scripts monitor -- --every 600   # every 10 minutes
pnpm --filter @lifeboat/scripts monitor -- --no-arkiv    # check and notify, write nothing
```

## For production
- Per-team watch lists and private delivery settings belong in an ordinary database (Postgres): emails, webhooks and API keys must never go on a public chain.
- The public findings stay on Arkiv.
- Run it as a scheduled job, with the paid RPC pools from [the roadmap](roadmap.md).
