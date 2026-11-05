import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getProfile } from "@forshtat/hegota-support/profiles";
import { env, repoPath } from "./env.js";

export const profile = getProfile("ethrex-eip8141-tracer");

export const NODE_URL = () => env("ALT_MEMPOOL_RPC_URL"); // ethrex (miner)
export const GATEWAY_URL = () => env("ALT_MEMPOOL_GATEWAY_URL"); // skandha gateway sidecar
export const MINER_SIDECAR_URL = () => `${env("ALT_MEMPOOL_RPC_URL").replace(/\/$/, "")}/rpc`;
export const EXPLORER = () => env("ALT_MEMPOOL_EXPLORER_URL");

export const CREATE2_FACTORY = "0x4e59b44847b379578588920ca78fbf26c0b4956c" as const;

export const devnet = () =>
  defineChain({
    id: Number(env("ALT_MEMPOOL_CHAIN_ID")),
    name: "EIP-8141 alt-mempool devnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [NODE_URL()] } },
  });

export const publicClient = () => createPublicClient({ chain: devnet(), transport: http(NODE_URL(), { retryCount: 4, timeout: 30_000 }) });

/** The dev wallet (EOA) that deploys and funds. The key stays in .env and is never logged. */
export function devWallet() {
  // accept the key with or without 0x / quotes / whitespace; never echo it
  const raw = env("DEV_PRIVATE_KEY").trim().replace(/^["']|["']$/g, "");
  const keyHex = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error("DEV_PRIVATE_KEY is not a 32-byte hex key (value not shown)");
  const account = privateKeyToAccount(keyHex);
  return { account, client: createWalletClient({ account, chain: devnet(), transport: http(NODE_URL(), { retryCount: 4, timeout: 30_000 }) }) };
}

export function yulInitcode(name: string): Hex {
  return readFileSync(repoPath("contracts", "yul", "out", `${name}.initcode.hex`), "utf8").trim() as Hex;
}

export const explorerTx = (hash: string, node = GATEWAY_URL()) => `${EXPLORER()}/tx/${hash}?node=${encodeURIComponent(node)}`;

const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);

/** Saves raw evidence for the docs: evidence/ef/<name>.json */
export function saveEvidence(name: string, data: unknown): string {
  const dir = repoPath("evidence", "ef");
  mkdirSync(dir, { recursive: true });
  const path = repoPath("evidence", "ef", `${name}.json`);
  writeFileSync(path, json({ savedAt: new Date().toISOString(), ...(data as object) }));
  return path;
}
