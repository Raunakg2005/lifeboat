// Drives the app through every beat of the narration while Chrome's screencast captures frames.
// Captions are drawn on the page (beat label + the line being spoken). Writes cache/frames/*.jpg,
// cache/frames.json and cache/timeline.json (where each narration line starts).
// Needs the app running (pnpm --filter @lifeboat/app dev) and Google Chrome installed.
// Usage: pnpm --filter @lifeboat/video record [--url http://localhost:5173] [--script submission]
//   --script submission: the real-voice cut (src/submission.mjs). No captions, no TTS: each line gets the time a
//   person needs to say it (~2.4 words a second), and the output goes to cache/submission/ for the teleprompter.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
const argScript = process.argv.indexOf("--script");
const SCRIPT = argScript > 0 ? process.argv[argScript + 1] : "rehearsal";
const SUBMISSION = SCRIPT === "submission";
// --voice: pace the submission to YOUR recorded lines (cache/submission/timeline-audio.json from voice_align.py)
const VOICE = SUBMISSION && process.argv.includes("--voice");
const MODULES = { rehearsal: "./narration.mjs", submission: "./submission.mjs", ens: "./ens-story.mjs" };
const { SEGMENTS } = await import(MODULES[SCRIPT] ?? "./narration.mjs");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = SCRIPT === "rehearsal" ? join(ROOT, "cache") : join(ROOT, "cache", SCRIPT);
const FRAMES = join(CACHE, "frames");
const argUrl = process.argv.indexOf("--url");
const URL0 = (argUrl > 0 ? process.argv[argUrl + 1] : "http://localhost:5173").replace(/\/+$/, "");
const W = 1280;
const H = 720;
const LEAD = VOICE ? 0.2 : 0.5; // seconds of picture before the first line of a beat
const GAP_LINE = VOICE ? 0.12 : 0.3;
const GAP_SEG = VOICE ? 0.3 : 0.8; // voiced: tight enough that the IBM beat still fits in 4:00
const FIRST = VOICE ? 1.0 : 2.5; // the first cue: time to settle (or to start talking, when you read along)

// how long a person takes to say a line, unhurried
const speakSeconds = (t) => Math.max(1.6, t.split(" ").filter(Boolean).length / 2.4 + 0.35);
const audio = VOICE
  ? JSON.parse(readFileSync(join(CACHE, "timeline-audio.json"), "utf8"))
  : SUBMISSION
  ? { voice: "your own", segments: SEGMENTS.map((sg) => ({ id: sg.id, lines: sg.lines.map((text) => ({ text, file: null, seconds: Number(speakSeconds(text).toFixed(2)) })) })) }
  : JSON.parse(readFileSync(join(CACHE, "timeline-audio.json"), "utf8"));
if (audio.segments.length !== SEGMENTS.length) throw new Error("timeline-audio.json is stale: run the tts step again");

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const OVERLAY = `
(() => {
  const css = \`
  #__cap { position: fixed; left: 22px; right: 22px; bottom: 18px; z-index: 2147483647; pointer-events: none;
    background: rgba(11,31,51,.94); color: #f2eee6; border: 3px solid #0b1f33; box-shadow: 6px 6px 0 #f05a1a;
    padding: 9px 16px 11px; font-family: Archivo, system-ui, sans-serif; transition: opacity .25s; }
  #__cap .b { font-family: "JetBrains Mono", Consolas, monospace; font-size: 12px; letter-spacing: 1.4px; text-transform: uppercase; color: #ff8a52; }
  #__cap .l { font-size: 20px; font-weight: 600; line-height: 1.32; margin-top: 3px; min-height: 26px; }
  #__badge { position: fixed; top: 76px; right: 22px; z-index: 2147483647; pointer-events: none; background: #f2eee6; color: #0b1f33;
    border: 2px solid #0b1f33; font-family: "JetBrains Mono", Consolas, monospace; font-size: 11px; letter-spacing: 1.2px; text-transform: uppercase; padding: 4px 8px; }
  \`;
  const mount = () => {
    if (document.getElementById("__cap")) return;
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    const d = document.createElement("div"); d.id = "__cap"; d.innerHTML = '<div class="b"></div><div class="l"></div>'; d.style.opacity = "0"; document.body.appendChild(d);
    const g = document.createElement("div"); g.id = "__badge"; g.textContent = "Rehearsal walkthrough · synthetic voice"; document.body.appendChild(g);
  };
  window.__beat = (b) => { mount(); const d = document.getElementById("__cap"); d.querySelector(".b").textContent = b; d.style.opacity = "1"; };
  window.__line = (t) => { mount(); document.querySelector("#__cap .l").textContent = t; };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();`;

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none"] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: "light" });
if (!SUBMISSION) await ctx.addInitScript(OVERLAY);
const page = await ctx.newPage();
page.setDefaultTimeout(15_000);

const now = () => Date.now() / 1000;
const sleep = (s) => new Promise((r) => setTimeout(r, Math.max(0, s * 1000)));

// helpers the narration's act() uses
const p = {
  async goHome() {
    if (!page.url().endsWith("#home")) await page.goto(`${URL0}/#home`);
    await this.scrollTo(0, 0.4);
  },
  async tab(label) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    await sleep(0.5);
  },
  async clickText(text) {
    const btn = page.getByRole("button", { name: text }).first();
    if (await btn.count()) await btn.click();
    else await page.getByText(text).first().click();
  },
  async scrollTo(y, seconds = 1.1) {
    await page.evaluate(
      ([to, ms]) =>
        new Promise((done) => {
          const from = window.scrollY;
          const max = document.documentElement.scrollHeight - window.innerHeight;
          const target = Math.max(0, Math.min(max, to));
          const t0 = performance.now();
          const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
          const step = (t) => {
            const k = Math.min(1, (t - t0) / ms);
            window.scrollTo(0, from + (target - from) * ease(k));
            if (k < 1) requestAnimationFrame(step);
            else done();
          };
          requestAnimationFrame(step);
        }),
      [y, seconds * 1000],
    );
  },
  async scrollBy(dy) {
    const y = await page.evaluate(() => window.scrollY);
    await this.scrollTo(y + dy);
  },
  async explainer(n) {
    const url = pathToFileURL(join(ROOT, "src", "ens-explainer.html")).href;
    if (!page.url().startsWith(url)) {
      await page.goto(`${url}#${n}`);
      await page.evaluate(() => document.fonts.ready);
    }
    await page.evaluate((k) => window.scene(k), n);
    await sleep(0.4);
  },
  async run(code) {
    await page.evaluate(code);
  },
  async goApp(hash) {
    await page.goto(`${URL0}/#${hash}`);
    await page.evaluate(() => document.fonts.ready);
    await sleep(0.8);
  },
  async scrollToSel(selector, offset = -80) {
    const loc = page.locator(selector).first();
    await loc.waitFor({ state: "attached", timeout: 20_000 });
    const top = await loc.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    await this.scrollTo(top + offset);
  },
  async type(text) {
    const box = page.locator(".passenger input");
    await box.click();
    await box.fill("");
    await box.pressSequentially(text, { delay: 70 });
    await sleep(0.3);
    await page.keyboard.press("Enter");
  },
  /** Types into any input like a person, then presses Enter (submits its form). */
  async typeIn(selector, text) {
    const box = page.locator(selector).first();
    await box.click();
    await box.fill("");
    await box.pressSequentially(text, { delay: 70 });
    await sleep(0.3);
    await page.keyboard.press("Enter");
  },
  async scrollToText(text, offset = -80) {
    let loc = page.getByText(text, { exact: true }).first();
    if (!(await loc.count())) loc = page.getByText(text).first();
    await loc.waitFor({ state: "attached", timeout: 20_000 });
    const top = await loc.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    await this.scrollTo(top + offset);
  },
};

// screencast
const cdp = await ctx.newCDPSession(page);
const frames = [];
let n = 0;
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  const file = `${String(n++).padStart(6, "0")}.jpg`;
  writeFileSync(join(FRAMES, file), Buffer.from(data, "base64"));
  frames.push({ file, ts: metadata.timestamp });
  try {
    await cdp.send("Page.screencastFrameAck", { sessionId });
  } catch {}
});

await page.goto(`${URL0}/#home`);
await page.evaluate(() => document.fonts.ready);
await sleep(1.5);
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 86, maxWidth: W, maxHeight: H, everyNthFrame: 2 });
await sleep(0.6);

const t0 = now();
const placed = [];
for (const [i, seg] of SEGMENTS.entries()) {
  const lines = audio.segments[i].lines;
  const speech = lines.reduce((s, l) => s + l.seconds, 0) + GAP_LINE * (lines.length - 1);
  const start = now();
  console.log(`${String(i + 1).padStart(2)}/${SEGMENTS.length} ${seg.id.padEnd(9)} ${speech.toFixed(1)} s`);
  if (!SUBMISSION) await page.evaluate((b) => window.__beat(b), `${String(i + 1).padStart(2, "0")} / ${SEGMENTS.length} · ${seg.label} · ${seg.title}`);

  // captions on their own clock; audio is placed at the same planned offsets
  let off = SUBMISSION && i === 0 ? FIRST : LEAD; // the first cue leaves 2.5 s to start talking
  const timers = [];
  for (const l of lines) {
    const at = off;
    placed.push({ file: l.file, text: l.text, t: start - t0 + at, seconds: l.seconds, seg: seg.id });
    if (!SUBMISSION) timers.push(sleep(at - (now() - start)).then(() => page.evaluate((t) => window.__line(t), l.text).catch(() => {})));
    off += l.seconds + GAP_LINE;
  }
  const at = async (frac, fn) => {
    await sleep(start + (SUBMISSION && i === 0 ? FIRST : LEAD) + frac * speech - now());
    await fn();
  };
  try {
    await seg.act(p, at, speech);
  } catch (e) {
    console.log(`   (action warning: ${String(e.message).split("\n")[0].slice(0, 120)})`);
  }
  await Promise.all(timers);
  await sleep(start + (SUBMISSION && i === 0 ? FIRST : LEAD) + speech + GAP_SEG - now());
}
if (!SUBMISSION) await page.evaluate(() => window.__line(""));
await sleep(1.5);
const end = now();
await cdp.send("Page.stopScreencast");
await sleep(0.5);
await browser.close();

const duration = end - t0;
writeFileSync(join(CACHE, "frames.json"), JSON.stringify(frames.map((f) => ({ file: f.file, t: Number((f.ts - t0).toFixed(4)) }))));
writeFileSync(
  join(CACHE, "timeline.json"),
  JSON.stringify({ duration, width: W, height: H, voice: audio.voice, lines: placed, silent: SUBMISSION && !VOICE, chapters: SEGMENTS.map((s, i) => ({ title: s.title, t: Math.max(0, placed.find((x) => x.seg === s.id).t - (SUBMISSION && i === 0 ? FIRST : LEAD)) })) }, null, 2),
);
console.log(`recorded ${duration.toFixed(1)} s, ${frames.length} frames`);
