// Full-page screenshots of the app at desktop and phone width, for a quick visual check.
// Usage: pnpm --filter @lifeboat/video shots [--url http://localhost:5173] [--tab home]
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (f, d) => (process.argv.indexOf(f) > 0 ? process.argv[process.argv.indexOf(f) + 1] : d);
const URL0 = arg("--url", "http://localhost:5173").replace(/\/+$/, "");
const tab = arg("--tab", "home");
const out = join(ROOT, "out", "shots");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars"] });
for (const [name, viewport] of [["desktop", { width: 1280, height: 720 }], ["phone", { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${URL0}/#${tab}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  const file = join(out, `${tab}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`${file}  horizontal overflow: ${overflow}px  page errors: ${errors.length ? errors.join(" | ") : "none"}`);
  await page.close();
}
await browser.close();
