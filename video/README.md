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
The free offline Windows voice (System.Speech), with no account or key. `SAPI_VOICE` picks the voice; the default is `Microsoft David Desktop`. Each line is cached by voice and text in `video/cache/tts`.

## Edit the script
Everything is in [`src/narration.mjs`](src/narration.mjs):
- each beat's caption lines and what the recorder does during it;
- a pronunciation table: captions keep "ENSv2", the voice says "E N S version two".

## Requirements
- Google Chrome. The recorder uses it through `playwright-core`, so nothing else needs downloading.
- A Python with PyAV (H.264, AAC) and numpy for the final mux. Set `VIDEO_PYTHON` to its path.
- Each take captures about 1.5 GB of frames; `compose` deletes them afterwards unless you pass `--keep-frames`.
