# Demo script (video: 3–4 min, ≥720p, screen + voice, no AI voice, no phone recording)

Live site: https://lifeboat-mu.vercel.app. Each beat has a fallback in case something is slow on the day.

| Time | Screen | Say (short) | Fallback |
|---|---|---|---|
| 0:00 | Home: "GET OFF BEFORE Q-DAY." and the manifest ticket | "A future quantum computer can take over any wallet whose public key is on-chain, and every signature puts it there. Lifeboat shows who could take over what, and gets them out. No quantum computer can do this today: this is readiness." | — |
| 0:20 | **Discover** tab | "Checkers ask 'has this address sent a transaction?'. Multisig signers publish their key every time they sign. Counting signatures, Optimism's Security Council goes from 4 to 13 of 13 public keys, and Base's nested 8-of-11 council from 0 to 11." | The snapshot loads instantly; skip the live re-run |
| 0:50 | Scan → `lifeboatdemo.eth` → **HIJACKABLE** tag, helm wheel | "Names too. ENSv2 control is spread over five paths. Here, the owner, a delegate, an operator and the resolver admin all have public keys on-chain. And we prove the role list is complete against the registry's own counts." | Recorded clip `clips/helm-demo.mp4` |
| 1:20 | Scan → `lifeboatpq.eth` → **PROTECTED** | "We handed this one over. The registry refused the naive transfer, accepted ours, and now a post-quantum wallet holds every path. It even signed its own `pq.checked` record." | docs/helm-check.md table |
| 1:45 | **Escape**: stat tiles + first PQ transaction | "The way out: an EIP-8141 account that checks a hash-based WOTS+C signature in Yul. 52k gas, the same for every signature." | — |
| 2:05 | Escape: the three lanes ("sail again") | "A wallet with tokens but no ETH escapes anyway. Our staked paymaster pays and is repaid in USDC. The public mempool refuses it, the unstaked alt mempool refuses it, the staked one includes it." | Explorer link |
| 2:35 | Escape: **forgery** tag | "One-time means one time. A naive wallet re-signs 12 fee bumps with the same key. From public data alone, the attacker forges a signature in 0.1 s and drains it, on the live devnet." | — |
| 2:55 | Escape: **hardware signer** (ESP32 on camera *only if* screen capture allows; otherwise the panel) | "Our signer keeps the counter on a device: Approve on the device, counter saved before signing, and it refuses to sign twice." | Show the firmware test output |
| 3:15 | **Harbour** | "Everything is re-checked on-chain and published to Arkiv. Readings expire in 24 hours. Anyone can report a key sighting, and the ledger caught the naive wallet signing twice. Full evidence lives on Swarm." | Click "evidence on Swarm" |
| 3:40 | README / repo | "Open source, built from scratch at Mumbai. Thank you." | — |

## Rehearse with the walkthrough video
`video/` renders a narrated, captioned run through every tab (`pnpm --filter @lifeboat/video make`, see [video/README.md](../video/README.md)). Watch it once, then record this script in your own voice.

## Checklist before recording
- [ ] Hard-refresh the live site; confirm the Harbour counts load (Arkiv reachable)
- [ ] Run one Helm check beforehand (warms the RPCs)
- [ ] Bee node running (Swarm links), batch TTL > 24 h
- [ ] Record each risky beat separately as a backup clip
