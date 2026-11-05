# Walkthrough video (rehearsal cut)

A narrated, captioned screen recording of the whole app: the landing page, Discover, Scan (Helm check and handover), Escape (PQ account, rescue, forgery, hardware), Harbour, and who it's for. It's for the team to learn the demo and rehearse it.

**The submission video should use your own voice** ([demo-script.md](../docs/demo-script.md)). This one uses a synthetic voice.

## Make it
```bash
pnpm --filter @lifeboat/app dev        # the app on http://localhost:5173 (keep it running)
pnpm --filter @lifeboat/video make     # TTS → recording → MP4
```
Output in `video/out/`:
- `lifeboat-walkthrough.mp4`: 1280×720, H.264 + AAC
- `lifeboat-walkthrough.srt`: subtitles
- `chapters.txt`: timestamps for each beat

The steps can also run one at a time: `tts`, `record`, `compose`. `shots` takes full-page screenshots at desktop and phone width.

## Voice
| Voice | When | Setup |
|---|---|---|
| **IBM Watson Text to Speech** | `IBM_TTS_APIKEY` and `IBM_TTS_URL` are set in the repo's `.env` | IBM Cloud → create **Text to Speech** (Lite plan, free) → Manage → Credentials → copy the API key and URL into `.env`. Optional: `IBM_TTS_VOICE` (default `en-US_MichaelExpressive`) |
| Offline Windows voice | Otherwise, or with `tts -- --offline` | Nothing to set up. `SAPI_VOICE` picks the voice (default `Microsoft David Desktop`) |

The narration is about 5,000 characters. The Lite plan allows 10,000 a month, and every line is cached by voice and text in `video/cache/tts`, so a re-render only pays for lines that changed.

## Edit the script
Everything is in [`src/narration.mjs`](src/narration.mjs):
- each beat's caption lines and what the recorder does during it;
- a pronunciation table: captions keep "ENSv2", the voice says "E N S version two".

## Requirements
- Google Chrome. The recorder uses it through `playwright-core`, so nothing else needs downloading.
- A Python with PyAV (H.264, AAC) and numpy for the final mux. Set `VIDEO_PYTHON` to its path.
