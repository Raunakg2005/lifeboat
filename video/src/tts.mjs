// Turns every narration line into a WAV, cached by (voice, text), and writes cache/timeline-audio.json.
// Voice: IBM Watson Text to Speech when IBM_TTS_APIKEY and IBM_TTS_URL are set in ../.env (the free Lite plan
// covers this script several times a month), otherwise the offline Windows voice (System.Speech).
// The key is only ever sent to the IBM URL; nothing here prints it.
// Usage: pnpm --filter @lifeboat/video tts [--offline]
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SEGMENTS, spoken } from "./narration.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "cache", "tts");
mkdirSync(CACHE, { recursive: true });

const key = process.env.IBM_TTS_APIKEY?.trim();
const url = process.env.IBM_TTS_URL?.trim().replace(/\/+$/, "");
const useIbm = !!(key && url) && !process.argv.includes("--offline");
const voice = useIbm ? process.env.IBM_TTS_VOICE?.trim() || "en-US_MichaelExpressive" : process.env.SAPI_VOICE?.trim() || "Microsoft David Desktop";
console.log(`voice: ${useIbm ? "IBM Watson" : "offline Windows"} · ${voice}`);

/** Duration in seconds from the WAV's fmt and data chunks (works when a streamed header leaves the size unset). */
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

async function ibm(text, out) {
  const r = await fetch(`${url}/v1/synthesize?voice=${encodeURIComponent(voice)}`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`apikey:${key}`).toString("base64"), "Content-Type": "application/json", Accept: "audio/wav;rate=24000" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`IBM TTS HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  writeFileSync(out, Buffer.from(await r.arrayBuffer()));
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
    const file = join(CACHE, `${useIbm ? "ibm" : "sapi"}-${createHash("sha1").update(voice + "\n" + say).digest("hex").slice(0, 16)}.wav`);
    return { text, say, file };
  }),
}));

const todo = plan.flatMap((s) => s.lines).filter((l) => !existsSync(l.file));
const chars = todo.reduce((n, l) => n + l.say.length, 0);
console.log(`${todo.length} new lines to synthesise (${chars} characters), ${plan.flatMap((s) => s.lines).length - todo.length} cached`);
if (useIbm) {
  for (const [i, l] of todo.entries()) {
    await ibm(l.say, l.file);
    process.stdout.write(`\r  ${i + 1}/${todo.length}`);
  }
  if (todo.length) process.stdout.write("\n");
} else sapi(todo.map((l) => ({ text: l.say, out: l.file })));

const timeline = plan.map((s) => ({ id: s.id, lines: s.lines.map((l) => ({ text: l.text, file: l.file, seconds: Number(wavSeconds(readFileSync(l.file)).toFixed(3)) })) }));
writeFileSync(join(ROOT, "cache", "timeline-audio.json"), JSON.stringify({ voice: `${useIbm ? "ibm" : "sapi"}:${voice}`, segments: timeline }, null, 2));
const total = timeline.flatMap((s) => s.lines).reduce((n, l) => n + l.seconds, 0);
console.log(`narration: ${total.toFixed(1)} s of speech in ${timeline.length} beats`);
