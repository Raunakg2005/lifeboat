// Public devnet addresses (committed): deployments/devnet-1337.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Address, Hex } from "viem";
import { repoPath } from "./env.js";

export interface Deployments {
  chainId: 1337;
  usdcImpl?: Address;
  usdc?: Address;
  paymaster?: Address;
  paymasterOwner?: Address;
  rescueEoa?: Address;
  txs: Record<string, Hex>;
}

const path = repoPath("deployments", "devnet-1337.json");

export function loadDeployments(): Deployments {
  if (!existsSync(path)) return { chainId: 1337, txs: {} };
  return JSON.parse(readFileSync(path, "utf8"));
}

export function saveDeployments(d: Deployments) {
  mkdirSync(repoPath("deployments"), { recursive: true });
  writeFileSync(path, JSON.stringify(d, null, 2) + "\n");
}

export function forgeBytecode(file: string, contract: string): Hex {
  const art = JSON.parse(readFileSync(repoPath("contracts", "out", file, `${contract}.json`), "utf8"));
  return art.bytecode.object as Hex;
}
