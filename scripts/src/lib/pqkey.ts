// The wallet's WOTS+C key and its leaf counter, stored in secrets/pq-key.json (gitignored).
// Rule: a leaf is reserved and written to disk BEFORE any signature made with it leaves this process.
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { LEAVES, fromHex, generateKeyPair, toHex, type KeyPair } from "@lifeboat/pq";
import { repoPath } from "./env.js";

export interface KeyFile {
  version: 1;
  label: string;
  skSeed: string; // secret
  pubSeed: string;
  root: string;
  nextLeaf: number;
  account?: string;
  log: { leaf: number; purpose: string; sigHash: string; at: string }[];
}

export const keyPath = (label: string) => repoPath("secrets", `pq-key-${label}.json`);

function writeDurably(path: string, data: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w", 0o600);
  writeSync(fd, data);
  fsyncSync(fd);
  closeSync(fd);
  renameSync(tmp, path);
}

export function loadOrCreateKey(label: string): { file: KeyFile; key: KeyPair; created: boolean } {
  const path = keyPath(label);
  if (existsSync(path)) {
    const file = JSON.parse(readFileSync(path, "utf8")) as KeyFile;
    const key = generateKeyPair(fromHex(file.skSeed), fromHex(file.pubSeed));
    if (toHex(key.root) !== file.root) throw new Error(`${path}: stored root does not match the seeds`);
    return { file, key, created: false };
  }
  const key = generateKeyPair(new Uint8Array(randomBytes(32)), new Uint8Array(randomBytes(32)));
  const file: KeyFile = { version: 1, label, skSeed: toHex(key.skSeed), pubSeed: toHex(key.pubSeed), root: toHex(key.root), nextLeaf: 0, log: [] };
  writeDurably(path, JSON.stringify(file, null, 2));
  return { file, key, created: true };
}

export function saveKeyFile(file: KeyFile) {
  writeDurably(keyPath(file.label), JSON.stringify(file, null, 2));
}

/** Reserves the next unused leaf for `sigHash` and persists it before returning. */
export function reserveLeaf(file: KeyFile, purpose: string, sigHash: string): number {
  const leaf = file.nextLeaf;
  if (leaf >= LEAVES) throw new Error("key exhausted: all 256 leaves used, rotate to a new key");
  file.nextLeaf = leaf + 1;
  file.log.push({ leaf, purpose, sigHash, at: new Date().toISOString() });
  saveKeyFile(file);
  return leaf;
}

/** Public part only (safe to print or commit). */
export const publicView = (file: KeyFile) => ({ label: file.label, root: file.root, pubSeed: file.pubSeed, nextLeaf: file.nextLeaf, account: file.account });
