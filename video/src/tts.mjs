// Turns every narration line into a WAV, cached by (voice, text), and writes cache/timeline-audio.json.
// Voice: the offline Windows voice (System.Speech), free and with no account. SAPI_VOICE picks the voice.
// Usage: pnpm --filter @lifeboat/video tts
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SEGMENTS, spoken } from "./narration.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "cache", "tts");
mkdirSync(CACHE, { recursive: true });

const voice = process.env.SAPI_VOICE?.trim() || "Microsoft David Desktop";
console.log(`voice: offline Windows · ${voice}`);

/** Duration in seconds from the WAV's fmt and data chunks. */
export function wavSeconds(buf) {
  let off = 12;
  let byteRate = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(off + 16);
    if (id === "data") {
      const bytes = size === 0 || size === 0xffffffff || off + 8 + size > buf.length ? buf.length - off - 8 : size;
      return bytes / byteRate;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error("no data chunk in WAV");
}

function sapi(jobs) {
  if (!jobs.length) return;
  const list = join(CACHE, "sapi-jobs.json");
  writeFileSync(list, JSON.stringify(jobs));
  const ps = [
    "Add-Type -AssemblyName System.Speech",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    `$s.SelectVoice('${voice.replace(/'/g, "")}')`,
    "$s.Rate = 0",
    "$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)",
    `foreach ($j in (Get-Content -Raw -Encoding UTF8 '${list}' | ConvertFrom-Json)) { $s.SetOutputToWaveFile($j.out, $fmt); $s.Speak($j.text); $s.SetOutputToNull() }`,
    "$s.Dispose()",
  ].join("; ");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "inherit" });
}

const plan = SEGMENTS.map((s) => ({
  id: s.id,
  lines: s.lines.map((text) => {
    const say = spoken(text);
    const file = join(CACHE, `sapi-${createHash("sha1").update(voice + "\n" + say).digest("hex").slice(0, 16)}.wav`);
    return { text, say, file };
  }),
}));

const todo = plan.flatMap((s) => s.lines).filter((l) => !existsSync(l.file));
console.log(`${todo.length} new lines to synthesise, ${plan.flatMap((s) => s.lines).length - todo.length} cached`);
sapi(todo.map((l) => ({ text: l.say, out: l.file })));

const timeline = plan.map((s) => ({ id: s.id, lines: s.lines.map((l) => ({ text: l.text, file: l.file, seconds: Number(wavSeconds(readFileSync(l.file)).toFixed(3)) })) }));
writeFileSync(join(ROOT, "cache", "timeline-audio.json"), JSON.stringify({ voice: `sapi:${voice}`, segments: timeline }, null, 2));
const total = timeline.flatMap((s) => s.lines).reduce((n, l) => n + l.seconds, 0);
console.log(`narration: ${total.toFixed(1)} s of speech in ${timeline.length} beats`);
