// Checks the ESP32 signer's screen while you wire it: asks the device every 3 s which SSD1306 address answers
// (WOTS|I2C), and stops as soon as the screen is found (the device then draws its idle screen).
// endTransmission codes: 0 = found, 2 = nothing at that address (check power and SDA/SCL), 4/5 = bus error.
// Usage: pnpm --filter @lifeboat/scripts hw-screen [--port COM5] [--minutes 10]
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { argValue } from "./lib/env.js";

const portPath = argValue("--port") ?? "COM5";
const minutes = Number(argValue("--minutes") ?? "10");
const port = new SerialPort({ path: portPath, baudRate: 115200, hupcl: false, autoOpen: false });
await new Promise<void>((res, rej) => port.open((e) => (e ? rej(e) : res())));
await new Promise<void>((res) => port.set({ dtr: false, rts: false }, () => res()));
const lines = port.pipe(new ReadlineParser({ delimiter: "\n" }));
let last = "";
let lastLines = "";
let found = false;
lines.on("data", (raw: string) => {
  const l = raw.trim();
  if (l === "WOTS|PONG") console.log("device answers ✓");
  if (l.startsWith("WOTS|PINSCAN|sda=")) console.log(`${new Date().toLocaleTimeString()}  screen answers on other pins: ${l.slice(13)} (move SDA to D21 and SCL to D22)`);
  // which pins a powered screen pulls high (its SDA/SCL resistors): shows each wire move as it happens
  if (l.startsWith("WOTS|LINES|") && l !== lastLines) console.log(`${new Date().toLocaleTimeString()}  pins held high: ${l.slice(17)}`), (lastLines = l);
  if (!l.startsWith("WOTS|I2C|")) return;
  if (l !== last) console.log(`${new Date().toLocaleTimeString()}  ${l}`);
  last = l;
  if (!l.endsWith("oled=none")) found = true;
});
await new Promise((r) => setTimeout(r, 800));
port.write("WOTS|PING\n");
const end = Date.now() + minutes * 60_000;
for (let i = 1; !found && Date.now() < end; i++) {
  port.write("WOTS|I2C\n");
  await new Promise((r) => setTimeout(r, 1500));
  port.write("WOTS|LINES\n");
  await new Promise((r) => setTimeout(r, 1500));
  if (i % 5 === 0 && !found) {
    port.write("WOTS|PINSCAN\n"); // every 15 s: is the screen answering on some other pair of pins?
    await new Promise((r) => setTimeout(r, 4000));
  }
}
port.close();
console.log(found ? "SCREEN FOUND: it should now show LIFEBOAT · post-quantum signer" : "no screen found in time");
process.exit(found ? 0 : 1);
