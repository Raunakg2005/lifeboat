# AI usage

ETHGlobal asks every team to say where and how AI tools were used. This file is kept up to date during the hackathon.

## Tools

- **Claude Code** (Anthropic): planning and research before the event; code generation, debugging and review during it; drafting docs.
- **Gemini** (Google): a second reviewer for the plan and the security checklist.
- **Whisper** (local, offline `faster-whisper`): transcribing a mentor's voice note, and word-level timing alignment of our recorded voice-over parts for the submission video.
- **Windows speech (System.Speech)**: the synthetic voice of our *internal rehearsal* video only. The submission video is narrated by a team member, as ETHGlobal requires.

## Where

| Area | How AI was used | How we checked it |
|---|---|---|
| Planning (before 5 Nov 21:00 IST) | Research on EIP-8141, ERC-8421, ENSv2, Arkiv and Swarm; competitor scan; a build runbook. Ideas and notes only, no code. Summary: [planning.md](planning.md) | Every fact was re-checked live against the devnets and contracts before use |
| WOTS+C library (`packages/pq`) | Written with AI assistance | Unit tests: sign/verify round trips, tampering, fixed digit sum, Merkle paths, cross-checked against the Yul verifier with shared test vectors |
| Yul PQ account (`contracts`) | Written with AI assistance | Foundry tests through a harness with the same verification code; dry-runs on the live devnet; gas measured |
| Devnet scripts (`scripts`) | Written with AI assistance | Every claim backed by a transaction hash or an admission report in `evidence/` |
| Rescue paymaster, forgery demo, Safe deep scan (`contracts`, `scripts`, `packages/core`) | Written with AI assistance | Live dry-runs and transactions on the devnet and mainnet reads; every number in the docs comes from saved evidence |
| Web app (`app`) | Written with AI assistance; the design follows the team's own pre-event look | Verified in the browser at desktop and phone widths, locally and on the live site |
| ESP32 firmware (`firmware/esp32`) | Written with AI assistance | The crypto core is compiled on the host and checked byte for byte against the TypeScript signer (`tools/firmware-check.mjs`) |
| Quantum Guard (`contracts/src/QuantumGuard.sol`, `scripts/src/quantum-guard.ts`) | Written with AI assistance | 9 Foundry tests with real WOTS+C signatures; a live run on a real Safe 1.4.1 on Sepolia (an owners-only payment refused on-chain, the co-signed one included) |
| ENSv2 survey (`scripts/src/ens-survey.ts`) and Safe deep scan in the app | Written with AI assistance | Real names only (ours excluded), one per owner; checked in the browser against live Safes, wallets and contracts |
| Toy Shor demo (`quantum/toy_ecdlp.py`) | Written with AI assistance | Ideal and noisy simulators recover the toy keys. The team ran the hardware job on IBM's ibm_fez with its own IBM Quantum key (job `dbmtusm74qds73dsvrf0`, raw counts in `evidence/quantum/`), and it returned the 2-bit key. Each result is labelled simulation or hardware |
| Video tooling (`video/`) and slides | Written with AI assistance: offline word-timing alignment (`transcribe_voice.py` + `voice_align.py`), audio cleanup (80 Hz high-pass, FFT noise reduction, loudness levelling), screen recording paced to the spoken lines (`record.mjs --voice`), real ESP32 phone footage compositing with live OLED screen tracking and burned-in subtitles (`hardware_insert.py`). No music: ETHGlobal asks for audio without music | The submission video's voice-over and the ESP32 hardware clip are recorded by the team. The voice is our own, cleaned and lined up but never sped up; the hardware clip, filmed on a phone, is 25 seconds inside the screen recording |
| Docs | Drafted with AI, edited by the team | Numbers come only from our own runs or cited sources |

## What the team did
- **Direction and scope:** chose the problem (hidden exposure, a way out), the partner tracks, what to cut and what to ship, and how findings are framed (public infrastructure only, no lists of people).
- **Product decisions from review:** dropped our own staged test names as "findings" in favour of a survey of real names; removed prefilled demo inputs; asked for Quantum Guard and the "check any Safe" flow.
- **Hardware:** sourced and wired the ESP32 and OLED, installed the USB driver, flashed the firmware, generated the key on the device and pressed the button for the device-signed transaction; the Dabao boards go to the Crossbar booth.
- **Operations:** funded the dev wallet, the Bee node and the Swarm batch from faucets, ran the Vercel deploys, and handled the partner and mentor conversations (including the mentor's feedback on the pitch wording).
- **Testing:** used the app and the hardware signer, and reported what was broken or unclear (for example the keygen stall at leaf 245 and the first UI drafts).
- **Pitch:** reviewed the slides, presents the demo and records the video's voice-over.

## Commit history

Commits carry no AI co-author trailers. This file is the disclosure instead.
