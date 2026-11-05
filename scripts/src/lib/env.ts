import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const REPO = fileURLToPath(new URL("../../../", import.meta.url));
export const repoPath = (...parts: string[]) => join(REPO, ...parts);

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env var ${name}: copy .env.example to .env and fill it in`);
  return v;
}

export function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

export function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
