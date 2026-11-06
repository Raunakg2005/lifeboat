#!/usr/bin/env node
// Builds the firmware crypto core for the host (in a throwaway Alpine container with g++) and checks it
// against the TypeScript signer's vectors: keccak256(""), the Merkle root, and a full leaf-0 signature. Then the
// clear-signing parser (clear.h) on every request in firmware/esp32/test/requests.json (made by
// scripts/src/gen-device-vectors.ts): the hash it rebuilds must match the host's, and the screen must show the details.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const vectors = JSON.parse(readFileSync(new URL("../contracts/test/vectors/wots.json", import.meta.url), "utf8"));
const c = vectors.cases.find((x) => x.name === "valid leaf 0");
const w = c.witness.slice(2);
const header = w.slice(0, 64);
const leaf = parseInt(header.slice(48, 56), 16);
const counter = parseInt(header.slice(56, 64), 16);
const sigsHex = w.slice(64, 64 + 64 * 64);

const requests = JSON.parse(readFileSync(new URL("../firmware/esp32/test/requests.json", import.meta.url), "utf8")).cases;
const input = requests.map((r) => `${r.deviceLeaf} ${r.line}`).join("\n") + "\n";
const cmd = `apk add --no-cache g++ >/dev/null 2>&1 && cd /src/firmware/esp32/test && g++ -O2 -std=c++17 -Wall -I ../lifeboat_signer host_test.cpp -o /tmp/host_test && /tmp/host_test ${leaf} ${c.sigHash} ${counter} && /tmp/host_test requests`;
const out = execFileSync("docker", ["run", "--rm", "-i", "-v", `${repo}:/src:ro`, "alpine:3.20", "sh", "-c", cmd], { encoding: "utf8", input, maxBuffer: 16 << 20 });
const kv = Object.fromEntries(out.trim().split(/\r?\n/).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

const checks = [
  ["keccak256('') matches Ethereum", kv.keccak256_empty === "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"],
  ["Merkle root matches the TypeScript key", "0x" + kv.root === vectors.root],
  ["leaf-0 signature accepted the right counter", kv.sign_ok === "1"],
  ["64 chain values match the TypeScript signature byte for byte", kv.sigs === sigsHex],
  ["a wrong counter is refused", kv.wrong_counter_refused === "1"],
];
requests.forEach((r, i) => {
  const err = kv[`case${i}.err`];
  if (r.error) return checks.push([`clear signing refuses: ${r.name} (${r.error})`, err === r.error]);
  const screen = Object.keys(kv).filter((k) => k.startsWith(`case${i}.line`)).map((k) => kv[k]);
  const text = [kv[`case${i}.title`], ...screen];
  const joined = text.join(""); // long values wrap over several 21-character lines
  const missing = r.show.filter((s) => !text.includes(s) && !joined.includes(s));
  checks.push([`clear signing: ${r.name}: same hash as the host`, err === "" && "0x" + kv[`case${i}.hash`] === r.sigHash]);
  checks.push([`clear signing: ${r.name}: screen shows ${r.show.length} details${missing.length ? " (missing: " + missing.join(", ") + " | shown: " + text.join(" / ") + ")" : ""}`, missing.length === 0]);
});
for (const [name, ok] of checks) console.log(`${ok ? "✅" : "❌"} ${name}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
