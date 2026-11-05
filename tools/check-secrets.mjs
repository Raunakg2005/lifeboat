#!/usr/bin/env node
// Pre-commit secret check. Blocks a commit when a staged file:
//  1. is a .env file (other than .env.example),
//  2. contains the value of any secret-looking variable from the local .env, or
//  3. contains a private-key assignment pattern.
// It never prints a secret value, only the file and the variable name.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|MNEMONIC|PRIVATE)/i;
const KEY_PATTERN = /(private[_-]?key|mnemonic|seed[_-]?phrase)\s*[:=]\s*["']?(0x)?[0-9a-f]{64}/i;

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]).split("\0").filter(Boolean);

const secrets = [];
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
    if (!m) continue;
    const [, name, value] = m;
    if (SECRET_NAME.test(name) && value.length >= 12) secrets.push({ name, value: value.replace(/^0x/i, "").toLowerCase() });
  }
}

// key files written by the scripts (WOTS+C seeds, throwaway EOA keys)
if (existsSync("secrets")) {
  for (const f of readdirSync("secrets").filter((n) => n.endsWith(".json"))) {
    try {
      const obj = JSON.parse(readFileSync(`secrets/${f}`, "utf8"));
      for (const name of ["skSeed", "privateKey"])
        if (typeof obj[name] === "string" && obj[name].length >= 34) secrets.push({ name: `secrets/${f}:${name}`, value: obj[name].replace(/^0x/i, "").toLowerCase() });
    } catch {}
  }
}

const problems = [];
for (const file of staged) {
  const base = file.split("/").pop() ?? file;
  if (/^\.env(\..*)?$/.test(base) && base !== ".env.example") {
    problems.push(`${file}: .env files must never be committed`);
    continue;
  }
  let text;
  try {
    text = git(["show", `:${file}`]);
  } catch {
    continue; // submodule or unreadable
  }
  if (text.includes("\0")) continue; // binary
  const lower = text.toLowerCase();
  for (const s of secrets) if (lower.includes(s.value)) problems.push(`${file}: contains the value of ${s.name}`);
  if (KEY_PATTERN.test(text)) problems.push(`${file}: looks like a private key assignment`);
}

if (problems.length) {
  console.error("Secret check failed:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`Secret check passed (${staged.length} staged files, ${secrets.length} secret values checked).`);
