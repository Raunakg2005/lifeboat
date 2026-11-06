// Runs compose.py with a Python that has PyAV (H.264 + AAC) and numpy, then deletes the captured frames
// (about 1.5 GB per take) unless --keep-frames is given.
//   --script submission: the silent real-voice cut, plus out/teleprompter.html to read along while it plays.
// Set VIDEO_PYTHON to choose the Python; the default is the local faster-whisper venv.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argScript = process.argv.indexOf("--script");
const SCRIPT = argScript > 0 ? process.argv[argScript + 1] : "rehearsal";
const SUBMISSION = SCRIPT === "submission";
const cache = SCRIPT === "rehearsal" ? join(ROOT, "cache") : join(ROOT, "cache", SCRIPT);
const name = { rehearsal: "lifeboat-walkthrough", submission: "lifeboat-submission-silent", ens: "lifeboat-ens-explained" }[SCRIPT] ?? `lifeboat-${SCRIPT}`;
const candidates = [process.env.VIDEO_PYTHON, join(process.env.LOCALAPPDATA ?? "", "Temp", "fdo", "venv", "Scripts", "python.exe"), "python"].filter(Boolean);
const py = candidates.find((c) => c === "python" || existsSync(c));
execFileSync(py, ["-I", join(ROOT, "src", "compose.py"), cache, join(ROOT, "out"), name], { stdio: "inherit" });

if (SUBMISSION) {
  const tl = JSON.parse(readFileSync(join(cache, "timeline.json"), "utf8"));
  const lines = tl.lines.map((l) => ({ t: Number(l.t.toFixed(2)), d: l.seconds, text: l.text }));
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  writeFileSync(
    join(ROOT, "out", "teleprompter.html"),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lifeboat teleprompter</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #0b1f33; color: #f2eee6; font-family: Archivo, "Segoe UI", system-ui, sans-serif; }
  header { padding: 14px 22px; font: 13px/1.5 Consolas, monospace; color: #b8c4d2; border-bottom: 3px solid #f05a1a; }
  header b { color: #ff8a52; }
  video { display: block; width: 100%; max-height: 52vh; background: #000; }
  #now { font-size: clamp(26px, 3.4vw, 44px); font-weight: 700; line-height: 1.25; padding: 18px 26px 6px; min-height: 2.6em; }
  #next { font-size: clamp(16px, 1.8vw, 22px); color: #8fa3b8; padding: 0 26px 18px; min-height: 2.4em; }
  #clock { position: fixed; top: 10px; right: 16px; font: 700 15px Consolas, monospace; background: #f05a1a; color: #0b1f33; padding: 4px 8px; }
</style></head><body>
<header><b>How to record:</b> 1) start your microphone recorder (voice only: Windows Voice Recorder, Audacity…) &nbsp; 2) press play below and read the big line out loud, at a normal pace &nbsp; 3) save it as <b>video/voice/voice.wav</b> (or .m4a / .mp3) &nbsp; 4) run <b>pnpm --filter @lifeboat/video final</b>. Your voice is lined up automatically. Pause and restart freely: only the final take counts.</header>
<video id="v" src="lifeboat-submission-silent.mp4" controls playsinline></video>
<div id="now">Press play, then read along.</div><div id="next"></div><div id="clock">0:00</div>
<script>
const LINES = ${JSON.stringify(lines.map((l) => ({ ...l, text: esc(l.text) })))};
const v = document.getElementById("v"), now = document.getElementById("now"), next = document.getElementById("next"), clock = document.getElementById("clock");
function tick() {
  const t = v.currentTime;
  let i = -1;
  for (let k = 0; k < LINES.length; k++) if (LINES[k].t - 0.25 <= t) i = k;
  const cur = LINES[i], nx = LINES[i + 1];
  now.innerHTML = cur && t < cur.t + cur.d + 1.2 ? cur.text : nx ? "<span style='color:#8fa3b8'>…</span>" : "Done. Stop the recorder.";
  next.innerHTML = nx ? "next: " + nx.text : "";
  clock.textContent = Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0");
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
</script></body></html>
`,
  );
  console.log("wrote out/teleprompter.html (open it next to out/lifeboat-submission-silent.mp4)");
}
if (!process.argv.includes("--keep-frames")) {
  rmSync(join(cache, "frames"), { recursive: true, force: true });
  console.log("deleted the captured frames (pass --keep-frames to keep them for another compose)");
}
