// Writes docs/voiceover-script.md from the recorded timeline: every line with the second it starts in the silent cut,
// how long it has, and what is on screen. Run after the submission recording (compose runs it for you).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(ROOT, "..");
const tl = JSON.parse(readFileSync(join(ROOT, "cache", "submission", "timeline.json"), "utf8"));
const { SEGMENTS } = await import("./submission.mjs");
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const SCREEN = {
  home: "Home: the problem, the six stops",
  discover: "Discover: Optimism Security Council, keys found by signatures",
  safe: "Scan → Safe: every signer's key recovered, live",
  names: "Scan → ENS name: the five control paths, the survey line, our test name lifeboatpq.eth",
  account: "Escape: the first post-quantum frame transaction",
  rescue: "Escape: the rescue, ❌ public mempool, ❌ unstaked, ✅ staked",
  guard: "Escape: Quantum Guard on a real Safe",
  forgery: "Escape: the forgery card (12 fee bumps, 0.2 s)",
  hardware: "Your ESP32 clip: PQ WALLET · setText · lifeboathw.eth → BOOT → SIGNED (enlarged screen, 5 steps)",
  "ens-hw": "Protect → ENS name: lifeboathw.eth PROTECTED, owned by the ESP32's wallet",
  close: "Harbour: open evidence → Swarm file matches the Arkiv record → Home",
};

let md = `# Voice-over script (submission video, ${mmss(tl.duration)})

Read this over \`video/out/lifeboat-submission-silent.mp4\`. The easiest way: open \`video/out/teleprompter.html\`, which plays the video and shows the line to say right now. Every line below starts at the time shown; the time after it is how long you have, at a calm pace (about 2.4 words a second).

**How to record:** a quiet room, phone or laptop mic close to your mouth (a headset mic is best), a voice recorder app running. Press play on the teleprompter and read along. Pause and restart freely: only the final take counts. Save it as \`video/voice/voice.wav\` (or .m4a / .mp3), or record in parts (\`video/voice/part1.ogg\`, …) and run \`pnpm --filter @lifeboat/video voice\`, which matches every line, cleans the voice and re-records the screen to your pace (2-4 min, 720p, real voice, no music, no speed-up).

**Tone:** calm and certain. Say the numbers clearly. "Q-Day" is "queue day". "ENS" is "E-N-S". "WOTS" doesn't need saying.

`;
for (const [i, seg] of SEGMENTS.entries()) {
  const ch = tl.chapters[i];
  const lines = tl.lines.filter((l) => l.seg === seg.id);
  md += `## ${mmss(ch.t)} · ${seg.title}\n*On screen: ${SCREEN[seg.id] ?? seg.label}*\n\n`;
  for (const l of lines) md += `- **${mmss(l.t)}** (${Math.round(l.seconds)} s) ${l.text}\n`;
  md += "\n";
}
md += `## After recording
1. \`video/voice/voice.wav\` saved.
2. \`pnpm --filter @lifeboat/video final\` → \`video/out/lifeboat-submission.mp4\` (your voice + the video, rules checked).
3. Upload the MP4 to ETHGlobal.com (the rules want the file there, voice only, no music), and put the link in the README.
`;
writeFileSync(join(REPO, "docs", "voiceover-script.md"), md);
console.log(`wrote docs/voiceover-script.md (${SEGMENTS.length} beats, ${tl.lines.length} lines, ${mmss(tl.duration)})`);
