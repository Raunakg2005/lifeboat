#!/usr/bin/env node
// Compiles each generated Yul object (contracts/yul/gen/*.yul) with solc in Yul mode, one file per run
// (Foundry can't compile several Yul files at once). Writes contracts/yul/out/<Name>.json.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SOLC_VERSION = "0.8.30";
const here = fileURLToPath(new URL("..", import.meta.url));
const genDir = join(here, "contracts", "yul", "gen");
const outDir = join(here, "contracts", "yul", "out");

function findSolc() {
  if (process.env.SOLC && existsSync(process.env.SOLC)) return process.env.SOLC;
  const bases = [process.env.APPDATA && join(process.env.APPDATA, "svm"), process.env.HOME && join(process.env.HOME, ".svm")].filter(Boolean);
  for (const base of bases)
    for (const file of [`solc-${SOLC_VERSION}`, `solc-${SOLC_VERSION}.exe`]) {
      const p = join(base, SOLC_VERSION, file);
      if (existsSync(p)) return p;
    }
  throw new Error(`solc ${SOLC_VERSION} not found: run "forge build" once (it installs solc via svm) or set SOLC`);
}

const solc = findSolc();
mkdirSync(outDir, { recursive: true });

for (const file of readdirSync(genDir).filter((f) => f.endsWith(".yul"))) {
  const name = file.replace(/\.yul$/, "");
  const input = {
    language: "Yul",
    sources: { [file]: { content: readFileSync(join(genDir, file), "utf8") } },
    settings: {
      evmVersion: "prague",
      optimizer: { enabled: true, runs: 1000, details: { yul: true } },
      outputSelection: { "*": { "*": ["evm.bytecode.object", "evm.deployedBytecode.object"] } },
    },
  };
  const out = JSON.parse(execFileSync(solc, ["--standard-json"], { input: JSON.stringify(input), encoding: "utf8", maxBuffer: 32 << 20 }));
  const errors = (out.errors ?? []).filter((e) => e.severity === "error");
  for (const e of out.errors ?? []) console.error(`${name}: ${e.severity}: ${e.formattedMessage ?? e.message}`);
  if (errors.length) process.exit(1);
  const contracts = out.contracts[file];
  const [objName, artifact] = Object.entries(contracts)[0];
  const initcode = "0x" + artifact.evm.bytecode.object;
  const runtime = "0x" + (artifact.evm.deployedBytecode?.object ?? "");
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify({ name: objName, solc: SOLC_VERSION, initcode, runtime }, null, 2));
  writeFileSync(join(outDir, `${name}.initcode.hex`), initcode);
  console.log(`${name}: initcode ${(initcode.length - 2) / 2} bytes, runtime ${(runtime.length - 2) / 2} bytes`);
}
