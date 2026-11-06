# Demo video: script and how to record it

## ETHGlobal's rules for the video
- 2 to 4 minutes, at least 720p.
- **A real voice:** no text-to-speech or AI voice-over, and no music with on-screen text instead of talking. Quiet background music under your voice is fine.
- **No speeding up**, and not recorded on a phone. Keep the intro under 20 seconds and cut out any waiting.
- Slides, if any: no more than 4 bullet points each.

## How we make it (the `video/` kit)
1. Start the app: `pnpm --filter @lifeboat/app dev`.
2. `pnpm --filter @lifeboat/video submission` drives the app through the script below and makes `video/out/lifeboat-submission-silent.mp4` (1280×720, about 3 minutes, original speed) and `video/out/teleprompter.html`.
3. Open the teleprompter. Start a voice-only recorder (Windows Voice Recorder or Audacity, with a headset or laptop mic in a quiet room), press play, and read the big line at a normal pace. Save the take as `video/voice/voice.wav` (or `.m4a` / `.mp3`).
4. `pnpm --filter @lifeboat/video final` lines your first word up with the first cue, levels the voice, and adds the synthesized music bed under it, dipping while you talk (`-- --no-music` for none). It writes `video/out/lifeboat-submission.mp4` and checks the length and resolution.
5. Watch it once, then upload.

## The script (`video/src/submission.mjs`)
Numbers are read from the evidence files when the video is made. No real person's ENS name is shown: real names appear only as the survey's totals.

| # | Screen | Say |
|---|---|---|
| 1 | Home | "Every time you sign anything on Ethereum, your public key goes on-chain. A future quantum computer could turn that public key into your private key. Lifeboat shows who could take over what on Q-Day, and gets them out. No quantum computer can do this today: this is about getting ready." |
| 2 | Discover | "Multisig signers publish their key every time they sign, even if they never send a transaction. Counting signatures, Optimism's Security Council goes from 4 to 13 of 13 public keys, and Base's nested council from 0 to 11." |
| 3 | Scan → a security council | "This works for any Safe. Paste its address, and Lifeboat recovers every signer's key from the Safe's own signatures, live, in a few seconds." |
| 4 | Scan → ENS name, survey line, then `lifeboatpq.eth` | "Names too. Lifeboat checks all five ways to control an ENS v2 name, and proves the list is complete. Across real names on Sepolia, one per owner, *N of M* can be steered on Q-Day, *K* of them through their resolver. Here's the way out, on our own test name: the registry refused a naive transfer, accepted our handover, and now a post-quantum wallet holds every path." |
| 5 | Escape: first PQ transaction | "To get out, Lifeboat gives you a post-quantum account: an EIP-8141 transaction that checks a hash-based signature in its own verify frame, for about 52,000 gas." |
| 6 | Escape: the rescue lanes | "If your wallet holds tokens but no ETH, a staked paymaster pays the gas, and is repaid in USDC in the same transaction. The public mempool refuses it, the unstaked alternative mempool refuses it, and the staked one includes it." |
| 7 | Escape: Quantum Guard | "Councils can't just move their funds. Quantum Guard adds a post-quantum co-signer to the Safe they already have. On a real Safe, a payment signed only by the owners was refused on-chain, with a missing post-quantum signature, and the co-signed payment went through. It covers off-chain signatures like Permit2 too." |
| 8 | Escape: forgery | "One-time keys must stay one-time. A wallet that re-signed twelve fee bumps with one key was forged in under a second, live on the devnet." |
| 9 | Escape: hardware signer | "So our signer keeps the key on a small device. It never signs a bare hash: it rebuilds what it signs from the request and shows it in words, amount, recipient, ENS name. It saves its counter before every signature and waits for a button press. Its last transaction was signed exactly that way." |
| 10 | Protect → ENS name → check `lifeboathw.eth` (PROTECTED, owner = the device's post-quantum wallet) | "Names work the same way. Our test name is now owned by a post-quantum wallet whose key exists only on that device. The wallet's address follows from the device's public key, so nothing is saved, and every change to the name is shown on the device before it signs." |
| 11 | Harbour → **open evidence** on lifeboatpq.eth → Home | "Every finding is re-checked and published to Arkiv, signed by our publisher, with an expiry. The full evidence sits on Swarm, and the app downloads it, hashes it in your browser, and shows that it matches the Arkiv record. The tools and data are free. Protocols pay for monitoring and help migrating. Lifeboat: get off before Q-Day." |

## Checklist before recording
- [ ] No other heavy job is using the public RPCs (the survey, a re-scan): the live checks in the take need them
- [ ] Hard-refresh the app; confirm the Harbour counts load (Arkiv reachable)
- [ ] Bee node running (Swarm links), batch TTL > 24 h
- [ ] Quiet room, headset mic, a glass of water

The internal rehearsal video (`pnpm --filter @lifeboat/video make`) uses a synthetic voice and is for practice only.
