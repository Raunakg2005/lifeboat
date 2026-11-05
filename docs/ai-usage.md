# AI usage

ETHGlobal asks every team to say where and how AI tools were used. This file is kept up to date during the hackathon.

## Tools

- **Claude Code** (Anthropic): planning and research before the event; code generation, debugging and review during it; drafting docs.
- **Gemini** (Google): a second reviewer for the plan and the security checklist.
- **Whisper** (local, offline): transcribing a mentor's voice note.

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
| Docs | Drafted with AI, edited by the team | Numbers come only from our own runs or cited sources |

## Commit history

Commits carry no AI co-author trailers. This file is the disclosure instead.
