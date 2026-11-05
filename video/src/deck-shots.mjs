// Crisp (2x) screenshots of the app's key panels, for the pitch deck. Needs the app on localhost:5173.
// Usage: node video/src/deck-shots.mjs  → video/out/deck/*.png
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out", "deck");
mkdirSync(OUT, { recursive: true });
const URL0 = "http://localhost:5173";

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

async function go(hash) {
  await page.goto(`${URL0}/#${hash}`);
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: ".topbar{position:static !important}" });
  await page.waitForTimeout(1200);
}
async function shot(name, locator, maxHeight) {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const box = await locator.boundingBox();
  const clip = { x: box.x - 8, y: box.y - 8, width: box.width + 22, height: Math.min(box.height + 22, maxHeight ?? 99999) };
  await page.screenshot({ path: join(OUT, `${name}.png`), clip, animations: "disabled" });
  console.log(name, Math.round(clip.width), "x", Math.round(clip.height));
}

await go("home");
await shot("landing-hero", page.locator(".landing-hero"));
await shot("manifest-ticket", page.locator(".ticket"));

await go("discover");
await shot("optimism-tag", page.locator(".ltag", { hasText: "Optimism Security Council" }).first());
await shot("proof-drawer", page.locator(".board", { hasText: "one example" }).first());
await shot("quantum", page.locator(".board", { hasText: "Public key → private key" }).first());

await go("check");
await page.getByRole("button", { name: "lifeboatdemo.eth (hijackable)" }).click();
await page.locator(".helm").first().waitFor({ timeout: 30_000 });
await page.waitForTimeout(1800);
await shot("helm-demo", page.locator(".ltag", { has: page.locator(".helm") }).first(), 700);
await shot("wheel-demo", page.locator(".helm-wheel").first());
await page.evaluate(() => window.scrollTo(0, 0));
await page.getByRole("button", { name: "lifeboatpq.eth (handed over)" }).click();
await page.waitForTimeout(800);
await page.locator(".helm").first().waitFor({ timeout: 30_000 });
await page.waitForTimeout(1800);
await shot("helm-pq", page.locator(".ltag", { has: page.locator(".helm") }).first(), 700);
await shot("wheel-pq", page.locator(".helm-wheel").first());

await go("escape");
await page.locator(".lanes").scrollIntoViewIfNeeded();
await page.waitForTimeout(5200);
await shot("rescue-lanes", page.locator(".lanes"));
await shot("forgery", page.locator(".section", { hasText: "Why one-time means one time" }).first(), 760);

await go("harbour");
await page.locator(".board", { hasText: "Logbook" }).first().waitFor({ timeout: 30_000 });
await page.waitForTimeout(2500);
await shot("logbook", page.locator(".board", { hasText: "Logbook" }).first(), 560);
await shot("logbook-short", page.locator(".board", { hasText: "Logbook" }).first(), 330);

await browser.close();
