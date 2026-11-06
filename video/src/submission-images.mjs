// The images for the ETHGlobal form, from the real app (needs it on localhost:5173):
//   logo.png 512×512 · cover.png 1280×720 · screenshots 1600×900 of Home, Scan (ENS), Discover, Escape, Protect, Harbour
// Writes docs/images/submission/. Usage: node video/src/submission-images.mjs [--url http://localhost:5173]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "docs", "images", "submission");
mkdirSync(OUT, { recursive: true });
const argUrl = process.argv.indexOf("--url");
const URL0 = (argUrl > 0 ? process.argv[argUrl + 1] : "http://localhost:5173").replace(/\/+$/, "");
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars", "--force-color-profile=srgb"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, colorScheme: "light" });
const page = await ctx.newPage();
page.setDefaultTimeout(60_000);
const go = async (hash) => {
  await page.goto(`${URL0}/#${hash}`);
  await page.evaluate(() => document.fonts.ready);
  await sleep(1.2);
};
const scrollTo = async (selectorOrText, offset = -90) => {
  const loc = selectorOrText.startsWith(".") || selectorOrText.startsWith("[") ? page.locator(selectorOrText).first() : page.getByText(selectorOrText).first();
  await loc.waitFor({ state: "attached" });
  const top = await loc.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  await page.evaluate((y) => window.scrollTo(0, y), top + offset);
  await sleep(0.8);
};
const shot = async (name) => {
  await page.screenshot({ path: join(OUT, name) });
  console.log("wrote", name);
};

// 1. Home
await go("home");
await shot("01-home.png");

// 2. Scan → ENS name: our own test name with the resolver trap
await go("check");
await page.getByRole("button", { name: "ENS name", exact: true }).first().click();
const box = page.locator(".passenger input").first();
await box.fill("lifeboatdemo.eth");
await page.keyboard.press("Enter");
await page.locator(".helm").first().waitFor({ state: "visible", timeout: 120_000 });
await sleep(4);
await scrollTo(".helm", -160);
await shot("02-scan-ens-helm-check.png");

// 3. Discover: keys revealed by signatures
await go("discover");
await scrollTo("Optimism Security Council", -120);
await shot("03-discover-councils.png");

// 4. Escape: the rescue, three answers
await go("escape");
await scrollTo("The rescue", -60);
await shot("04-escape-rescue.png");

// 5. Protect → ENS name: a name owned by the ESP32's post-quantum wallet
await go("protect");
await page.getByRole("button", { name: "ENS name", exact: true }).first().click();
await page.locator('input[placeholder="name.eth"]').fill("lifeboathw.eth");
await page.keyboard.press("Enter");
await page.getByText("Already protected").first().waitFor({ state: "visible", timeout: 120_000 });
await sleep(1);
await scrollTo("Already protected", -330);
await shot("05-protect-ens-hardware.png");

// 6. Harbour: the Swarm evidence matched to its Arkiv record
await go("harbour");
await page.getByText("open evidence").first().waitFor({ state: "visible", timeout: 60_000 });
await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim().toLowerCase() === "open evidence");
  const own = btns.find((b) => {
    let el = b.parentElement;
    while (el && !el.textContent.includes("lifeboatpq.eth")) el = el.parentElement;
    return el && [...el.querySelectorAll("button")].filter((x) => x.textContent.trim().toLowerCase() === "open evidence").length === 1;
  });
  (own || btns[0]).click();
});
await page.getByText("MATCHES").first().waitFor({ state: "visible", timeout: 60_000 });
await sleep(1.5);
await shot("06-harbour-evidence-matches.png");

// ---------- logo and cover, in the app's own fonts and colours ----------
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;800&family=Big+Shoulders+Stencil+Display:wght@900&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet">`;
const BOAT = `<svg viewBox="0 0 80 52"><path d="M38 4v30" stroke="#0b1f33" stroke-width="2.5"/><path d="M40 6l20 24H40z" fill="#f2eee6" stroke="#0b1f33" stroke-width="2" stroke-linejoin="round"/><path d="M6 34h68l-9 14H15z" fill="#f05a1a" stroke="#0b1f33" stroke-width="2.5" stroke-linejoin="round"/><path d="M11 39h58" stroke="#0b1f33" stroke-width="1.5"/><circle cx="28" cy="43" r="2" fill="#0b1f33"/><circle cx="40" cy="43" r="2" fill="#0b1f33"/><circle cx="52" cy="43" r="2" fill="#0b1f33"/></svg>`;
const WAVES = (w, h) => `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="position:absolute;left:0;bottom:0;width:100%;height:${h}px">
  <path d="M0 ${h * 0.35} Q ${w / 8} ${h * 0.15} ${w / 4} ${h * 0.35} T ${w / 2} ${h * 0.35} T ${(3 * w) / 4} ${h * 0.35} T ${w} ${h * 0.35} V${h} H0Z" fill="#a9cbe6"/>
  <path d="M0 ${h * 0.55} Q ${w / 8} ${h * 0.4} ${w / 4} ${h * 0.55} T ${w / 2} ${h * 0.55} T ${(3 * w) / 4} ${h * 0.55} T ${w} ${h * 0.55} V${h} H0Z" fill="#5f93c4"/>
  <path d="M0 ${h * 0.75} Q ${w / 8} ${h * 0.62} ${w / 4} ${h * 0.75} T ${w / 2} ${h * 0.75} T ${(3 * w) / 4} ${h * 0.75} T ${w} ${h * 0.75} V${h} H0Z" fill="#1f4f80"/></svg>`;
const render = async (html, w, h, name) => {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(html, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await sleep(0.5);
  await p.screenshot({ path: join(OUT, name) });
  await p.close();
  console.log("wrote", name);
};

await render(
  `<!doctype html><html><head>${FONTS}<style>
  body{margin:0;width:512px;height:512px;background:#f2eee6;position:relative;overflow:hidden;font-family:Archivo}
  .sky{position:absolute;inset:0;background:radial-gradient(circle at 50% 40%,#fbf8f2 0,#f2eee6 70%)}
  .stripe{position:absolute;left:0;right:0;top:0;height:30px;background:repeating-linear-gradient(-45deg,#f05a1a 0 18px,#0b1f33 18px 36px)}
  .boat{position:absolute;left:96px;top:174px;width:320px;z-index:2}
  .name{position:absolute;left:0;right:0;top:36px;text-align:center;font-family:'Big Shoulders Stencil Display';font-weight:900;font-size:58px;letter-spacing:3px;color:#f2eee6;display:none}
  </style></head><body><div class="sky"></div><div class="stripe"></div><div class="boat">${BOAT}</div>${WAVES(512, 190)}</body></html>`,
  512,
  512,
  "logo.png",
);

const b64 = (f) => `data:image/png;base64,${readFileSync(join(OUT, f)).toString("base64")}`;
await render(
  `<!doctype html><html><head>${FONTS}<style>
  body{margin:0;width:1280px;height:720px;background:#f2eee6;position:relative;overflow:hidden;font-family:Archivo;color:#0b1f33}
  .bar{position:absolute;left:0;right:0;top:0;height:64px;background:#0b1f33}
  .stripe{position:absolute;left:0;right:0;top:64px;height:14px;background:repeating-linear-gradient(-45deg,#f05a1a 0 14px,#0b1f33 14px 28px)}
  .mark{position:absolute;left:56px;top:13px;font-family:'Big Shoulders Stencil Display';font-weight:900;font-size:36px;letter-spacing:2px;color:#fff}
  .sub{position:absolute;left:246px;top:28px;font-family:'JetBrains Mono';font-size:14px;letter-spacing:2px;color:#b8c4d2}
  h1{position:absolute;left:56px;top:112px;width:570px;margin:0;font-family:'Big Shoulders Stencil Display';font-weight:900;font-size:78px;line-height:.96;letter-spacing:1px}
  h1 em{font-style:normal;color:#f05a1a}
  p{position:absolute;left:58px;top:368px;width:540px;margin:0;font-size:23px;line-height:1.38;font-weight:600}
  .chips{position:absolute;left:56px;top:500px;width:580px;display:flex;flex-wrap:wrap;gap:10px}
  .chip{font-family:'JetBrains Mono';font-weight:700;font-size:14px;letter-spacing:1px;border:2.5px solid #0b1f33;background:#fff;padding:7px 11px;box-shadow:4px 4px 0 #0b1f33}
  .shot{position:absolute;border:4px solid #0b1f33;box-shadow:10px 10px 0 #f05a1a;background:#fff}
  .s1{left:650px;top:122px;width:560px;transform:rotate(-1.6deg)}
  .s2{left:780px;top:392px;width:440px;transform:rotate(1.4deg)}
  .boat{position:absolute;left:1080px;top:592px;width:120px;z-index:3}
  </style></head><body>
  <div class="bar"></div><div class="stripe"></div><div class="mark">LIFEBOAT</div><div class="sub">Q-DAY READINESS · PORT OF MUMBAI</div>
  <h1>WHO COULD<br>TAKE OVER WHAT<br><em>ON Q-DAY?</em></h1>
  <p>Lifeboat finds the wallets, Safes and ENS names a future quantum computer could take over, and moves them to post-quantum keys.</p>
  <div class="chips"><span class="chip">EIP-8141 ALT MEMPOOL</span><span class="chip">ENSv2</span><span class="chip">ARKIV + SWARM</span><span class="chip">ESP32 CLEAR SIGNING</span></div>
  <img class="shot s1" src="${b64("02-scan-ens-helm-check.png")}">
  <img class="shot s2" src="${b64("06-harbour-evidence-matches.png")}">
  ${WAVES(1280, 130)}<div class="boat">${BOAT}</div>
  </body></html>`,
  1280,
  720,
  "cover.png",
);

await browser.close();
writeFileSync(join(OUT, "README.md"), "# Images for the ETHGlobal submission\n\nMade by `video/src/submission-images.mjs` from the real app: `logo.png` (512×512), `cover.png` (1280×720) and screenshots `01`–`07` (1600×900; `07` is a frame from the submission video).\n");
console.log("done:", OUT);
