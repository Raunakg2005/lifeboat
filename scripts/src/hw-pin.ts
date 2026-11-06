// PIN lock on the ESP32 signer. Reads the PIN from DEVICE_PIN (put it in .env yourself; it is never printed or saved).
//   --set     encrypt the key with DEVICE_PIN (the device asks for BOOT first)
//   --test    prove the lock: lock it, a request is refused, a wrong PIN is refused, then unlock and sign a message
//   --status  print the lock state
// Writes evidence/hardware/pin-lock.json (no PIN in it). Usage: pnpm --filter @lifeboat/scripts hw-pin --set|--test|--status
import { mkdirSync, writeFileSync } from "node:fs";
import { messageRequest } from "@lifeboat/core";
import { toHex } from "@lifeboat/pq";
import { argValue, hasFlag, repoPath } from "./lib/env.js";
import { openDevice } from "./lib/device.js";

const pin = process.env.DEVICE_PIN ?? "";
const device = await openDevice(argValue("--port") ?? "COM5");
const evidence: Record<string, unknown> = { at: new Date().toISOString(), checks: {} as Record<string, unknown> };
const checks = evidence.checks as Record<string, unknown>;
let info = await device.info();
console.log(`device key ${toHex(info.root).slice(0, 12)}…, next leaf ${info.next}, PIN ${info.pinSet ? "on" : "off"}, ${info.locked ? "locked" : "unlocked"}`);

if (hasFlag("--set")) {
  if (pin.length < 4) throw new Error("put DEVICE_PIN=<4 to 32 characters> in .env first");
  if (info.locked) await device.unlock(pin);
  await device.setPin(pin, () => console.log("\n>>> The ESP32 asks SET PIN? Read the pages, BOOT for each, then BOOT to confirm. <<<\n"));
  info = await device.info();
  console.log(`PIN set: the key is stored encrypted (PIN ${info.pinSet ? "on" : "off"}, ${info.locked ? "locked" : "unlocked until power-off"})`);
  checks.pinSet = info.pinSet;
}

if (hasFlag("--test")) {
  if (!info.pinSet) throw new Error("no PIN yet: run with --set first");
  if (pin.length < 4) throw new Error("put DEVICE_PIN in .env first");
  // 1. lock: nothing can be signed
  if (!info.locked) await device.lock();
  const req = messageRequest(`Lifeboat PIN lock test ${new Date().toISOString()}`);
  const refused = await device.raw(req.line(0));
  checks.lockedRequestRefused = refused === "WOTS|ERR|locked";
  console.log(`${checks.lockedRequestRefused ? "✅" : "❌"} locked: a signing request is refused (${refused})`);
  // 2. a wrong PIN is refused (one wrong try; the count resets on the right PIN)
  try {
    await device.unlock(pin + "x");
    checks.wrongPinRefused = false;
  } catch (e) {
    checks.wrongPinRefused = /wrong PIN/.test(String((e as Error).message));
  }
  console.log(`${checks.wrongPinRefused ? "✅" : "❌"} a wrong PIN is refused`);
  info = await device.info();
  checks.stillLocked = info.locked;
  // 3. the right PIN unlocks, and signing works again (BOOT press)
  await device.unlock(pin);
  info = await device.info();
  checks.unlocked = !info.locked;
  console.log(`${checks.unlocked ? "✅" : "❌"} the right PIN unlocks it`);
  const levels = await device.tree(info);
  const signed = await device.sign(info, levels, req, (leaf, attempt) => console.log(`\n>>> Unlocked: the ESP32 shows the test message (leaf ${leaf}). BOOT for each page, then BOOT to sign. (attempt ${attempt}) <<<\n`));
  checks.signsAfterUnlock = signed.deviceHash === req.sigHash;
  checks.leaf = signed.leaf;
  console.log(`${checks.signsAfterUnlock ? "✅" : "❌"} unlocked, it signs again (leaf ${signed.leaf}, signature verified here)`);
}

if (!hasFlag("--set") && !hasFlag("--test")) console.log("nothing to do: pass --set, --test or --status");
device.close();
if (hasFlag("--set") || hasFlag("--test")) {
  mkdirSync(repoPath("evidence", "hardware"), { recursive: true });
  writeFileSync(repoPath("evidence", "hardware", "pin-lock.json"), JSON.stringify(evidence, null, 2));
}
const ok = Object.entries(checks).every(([k, v]) => k === "leaf" || v === true);
console.log(ok ? "OK" : "FAILED");
process.exit(ok ? 0 : 1);
