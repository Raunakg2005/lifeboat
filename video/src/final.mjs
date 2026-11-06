// The submission video: out/lifeboat-submission-silent.mp4 + your recorded voice (video/voice/voice.*) + the music bed.
// Usage: pnpm --filter @lifeboat/video final [-- --voice path] [--no-music] [--music path] [--offset seconds]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (f) => (process.argv.indexOf(f) > 0 ? process.argv[process.argv.indexOf(f) + 1] : undefined);
const voiceDir = join(ROOT, "voice");
const voice = arg("--voice") ?? (existsSync(voiceDir) ? readdirSync(voiceDir).filter((f) => /\.(wav|m4a|mp3|ogg|webm|flac)$/i.test(f)).map((f) => join(voiceDir, f))[0] : undefined);
if (!voice) {
  console.error("No voice recording found. Record it with out/teleprompter.html and save it in video/voice/ (voice.wav, .m4a or .mp3).");
  process.exit(1);
}
const silent = join(ROOT, "out", "lifeboat-submission-silent.mp4");
if (!existsSync(silent)) {
  console.error("No silent cut yet: run `pnpm --filter @lifeboat/video submission` first (with the app running).");
  process.exit(1);
}
const tl = JSON.parse(readFileSync(join(ROOT, "cache", "submission", "timeline.json"), "utf8"));
const firstLine = tl.lines[0]?.t ?? 2.5;
const py = [process.env.VIDEO_PYTHON, join(process.env.LOCALAPPDATA ?? "", "Temp", "fdo", "venv", "Scripts", "python.exe"), "python"].filter(Boolean).find((c) => c === "python" || existsSync(c));
const extra = [];
if (process.argv.includes("--no-music")) extra.push("--no-music");
if (arg("--music")) extra.push("--music", arg("--music"));
if (arg("--offset")) extra.push("--offset", arg("--offset"));
execFileSync(py, ["-I", join(ROOT, "src", "final.py"), silent, voice, join(ROOT, "out", "lifeboat-submission.mp4"), "--first-line", String(firstLine), ...extra], { stdio: "inherit" });
