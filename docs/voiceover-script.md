# Voice-over script (submission video, 3:49)

Read this over `video/out/lifeboat-submission-silent.mp4`. The easiest way: open `video/out/teleprompter.html`, which plays the video and shows the line to say right now. Every line below starts at the time shown; the time after it is how long you have, at a calm pace (about 2.4 words a second).

**How to record:** a quiet room, phone or laptop mic close to your mouth (a headset mic is best), a voice recorder app running. Press play on the teleprompter and read along. Pause and restart freely: only the final take counts. Save it as `video/voice/voice.wav` (or .m4a / .mp3), then run `pnpm --filter @lifeboat/video final`, which lines your voice up with the video and checks the rules (2-4 min, 720p, real voice, no speed-up).

**Tone:** calm and certain. Say the numbers clearly. "Q-Day" is "queue day". "ENS" is "E-N-S". "WOTS" doesn't need saying.

## 0:00 · The problem
*On screen: Home: the problem, the six stops*

- **0:02** (5 s) Every time you sign anything on Ethereum, your public key goes on-chain.
- **0:08** (6 s) A future quantum computer could turn that public key into your private key.
- **0:14** (11 s) Lifeboat shows who could take over what on Q-Day, and gets them out. No quantum computer can do this today: this is about getting ready.

## 0:25 · Keys revealed by signatures
*On screen: Discover: Optimism Security Council, keys found by signatures*

- **0:26** (7 s) Multisig signers publish their key every time they sign, even if they never send a transaction.
- **0:33** (10 s) Counting signatures, Optimism's Security Council goes from 4 to 13 of 13 public keys, and Base's nested council from 0 to 11.

## 0:43 · Any Safe, live
*On screen: Scan → Safe: every signer's key recovered, live*

- **0:44** (10 s) This works for any Safe. Paste its address, and Lifeboat recovers every signer's key from the Safe's own signatures, live, in a few seconds.

## 0:55 · Names: who can steer them
*On screen: Scan → ENS name: the five control paths, the survey line, our test name lifeboatpq.eth*

- **0:56** (8 s) Names too. Lifeboat checks all five ways to control an ENS v2 name, and proves the list is complete.
- **1:04** (10 s) Across real names on Sepolia, one per owner, 902 of 1011 can be steered on Q-Day, 863 of them through their resolver.
- **1:14** (11 s) Here's the way out, on our own test name: the registry refused a naive transfer, accepted our handover, and now a post-quantum wallet holds every path.

## 1:26 · A post-quantum account
*On screen: Escape: the first post-quantum frame transaction*

- **1:26** (11 s) To get out, Lifeboat gives you a post-quantum account: an EIP-8141 transaction that checks a hash-based signature in its own verify frame, for about 52,000 gas.

## 1:38 · No ETH? Still escapes
*On screen: Escape: the rescue, ❌ public mempool, ❌ unstaked, ✅ staked*

- **1:39** (10 s) If your wallet holds tokens but no ETH, a staked paymaster pays the gas, and is repaid in USDC in the same transaction.
- **1:49** (7 s) The public mempool refuses it, the unstaked alternative mempool refuses it, and the staked one includes it.

## 1:57 · Protect a Safe in place
*On screen: Escape: Quantum Guard on a real Safe*

- **1:58** (8 s) Councils can't just move their funds. Quantum Guard adds a post-quantum co-signer to the Safe they already have.
- **2:06** (14 s) On a real Safe, a payment signed only by the owners was refused on-chain, with a missing post-quantum signature, and the co-signed payment went through. It covers off-chain signatures like Permit2 too.

## 2:21 · One-time means one time
*On screen: Escape: the forgery card (12 fee bumps, 0.2 s)*

- **2:21** (11 s) One-time keys must stay one-time. A wallet that re-signed twelve fee bumps with one key was forged in under a second, live on the devnet.

## 2:33 · Sign safely
*On screen: Your ESP32 clip: PQ WALLET · setText · lifeboathw.eth → BOOT → SIGNED (enlarged screen, 5 steps)*

- **2:33** (14 s) So our signer keeps the key on a small device. It never signs a bare hash: it rebuilds what it signs from the request and shows it in words, amount, recipient, ENS name.
- **2:48** (9 s) It saves its counter before every signature and waits for a button press. Its last transaction was signed exactly that way.

## 2:57 · A name on the device
*On screen: Protect → ENS name: lifeboathw.eth PROTECTED, owned by the ESP32's wallet*

- **2:58** (10 s) Names work the same way. Our test name is now owned by a post-quantum wallet whose key exists only on that device.
- **3:08** (12 s) The wallet's address follows from the device's public key, so nothing is saved, and every change to the name is shown on the device before it signs.

## 3:20 · Publish, and the close
*On screen: Harbour: open evidence → Swarm file matches the Arkiv record → Home*

- **3:21** (7 s) Every finding is re-checked and published to Arkiv, signed by our publisher, with an expiry.
- **3:28** (10 s) The full evidence sits on Swarm, and the app downloads it, hashes it in your browser, and shows that it matches the Arkiv record.
- **3:38** (6 s) The tools and data are free. Protocols pay for monitoring and help migrating.
- **3:44** (2 s) Lifeboat: get off before Q-Day.

## After recording
1. `video/voice/voice.wav` saved.
2. `pnpm --filter @lifeboat/video final` → `video/out/lifeboat-submission.mp4` (your voice + the video, rules checked).
3. Upload it (YouTube unlisted works), put the link in the README and in the submission form.
