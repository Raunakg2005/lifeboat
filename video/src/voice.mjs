// Your recorded voice-over → the finished submission video.
//   1. transcribe video/voice/part*.{ogg,m4a,mp3,wav} offline (faster-whisper, word timings)
//   2. align them to the script, cut and clean one clip per line (voice_align.py)
//   3. record the screen paced to your lines (record.mjs --voice; needs the app on localhost:5173)
//   4. compose: your voice, the ESP32 clip (video/clips/esp32-ens.mp4) and burned-in subtitles → out/lifeboat-submission.mp4 + .srt
// Usage: pnpm --filter @lifeboat/video voice [--no-record | --align-only]
//   --no-record: reuse the last recording, re-cut the voice only · --align-only: stop after matching the lines (prints the report)
// To add a line later: record just that line as a new part numbered to sit between the others (part2 between part1 and part3).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const py = [process.env.VIDEO_PYTHON, join(ROOT, ".venv", "Scripts", "python.exe"), join(process.env.LOCALAPPDATA ?? "", "Temp", "fdo", "venv", "Scripts", "python.exe"), "python"].filter(Boolean).find((c) => c === "python" || existsSync(c));
const parts = readdirSync(join(ROOT, "voice"))
  .filter((f) => /^part\d+\.(ogg|m4a|mp3|wav|opus)$/i.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
  .map((f) => join(ROOT, "voice", f));
if (!parts.length) throw new Error("put your recordings in video/voice/ as part1.ogg, part2.ogg, … (in reading order)");
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT });
// the lines to align to come from the script itself, so a new line is matched before it has ever been recorded
const { SEGMENTS } = await import("./submission.mjs");
const speak = (t) => Math.max(1.6, t.split(" ").filter(Boolean).length / 2.4 + 0.35);
mkdirSync(join(ROOT, "cache", "submission"), { recursive: true });
writeFileSync(
  join(ROOT, "cache", "submission", "script.json"),
  JSON.stringify({ chapters: SEGMENTS.map((s) => ({ title: s.title })), lines: SEGMENTS.flatMap((s) => s.lines.map((text) => ({ seg: s.id, text, seconds: Number(speak(text).toFixed(2)) }))) }, null, 1),
);
run(py, ["-I", join(ROOT, "src", "transcribe_voice.py"), join(ROOT, "cache", "voice-words.json"), ...parts]);
if (process.argv.includes("--align-only")) {
  run(py, ["-I", join(ROOT, "src", "voice_align.py"), ROOT]);
  process.exit(0);
}
run(py, ["-I", join(ROOT, "src", "voice_align.py"), ROOT]);
if (!process.argv.includes("--no-record")) run(process.execPath, [join(ROOT, "src", "record.mjs"), "--script", "submission", "--voice"]);
run(process.execPath, [join(ROOT, "src", "compose.mjs"), "--script", "submission"]);
console.log("done: video/out/lifeboat-submission.mp4 (+ .srt)");
