// ENSv2 on Sepolia: addresses, ABIs (from Sourcify, scripts/abi/ens), role bits (from the verified
// RegistryRolesLib / PermissionedResolverLib sources), and clients.
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { env, envOr, repoPath } from "./env.js";

const abi = (name: string) => JSON.parse(readFileSync(repoPath("scripts", "abi", "ens", `${name}.json`), "utf8")) as Abi;

export const ENS = JSON.parse(readFileSync(repoPath("scripts", "abi", "ens", "addresses.json"), "utf8")) as Record<
  "UniversalResolver" | "RootRegistry" | "ETHRegistry" | "ETHRegistrar" | "PermissionedResolverImpl" | "VerifiableFactory" | "UniversalHelper" | "MockUSDC",
  Address
>;
export const SEPOLIA_RPC = () => envOr("SEPOLIA_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com");
export const ENS_V2_FROM_BLOCK = 11_820_399n; // first ENSv2 block on Sepolia

export const registryAbi = abi("ETHRegistry"); // PermissionedRegistry (root and .eth share it)
export const registrarAbi = abi("ETHRegistrar");
export const resolverAbi = abi("PermissionedResolverImpl");
export const factoryAbi = abi("VerifiableFactory");
export const helperAbi = abi("UniversalHelper");
export const usdcAbi = abi("MockUSDC");

/** Registry roles: RegistryRolesLib.sol. One nybble per role; admin = role << 128. */
export const REGISTRY_ROLES: Record<string, bigint> = {
  REGISTRAR: 1n << 0n,
  REGISTER_RESERVED: 1n << 4n,
  SET_PARENT: 1n << 8n,
  UNREGISTER: 1n << 12n,
  RENEW: 1n << 16n,
  SET_SUBREGISTRY: 1n << 20n,
  SET_RESOLVER: 1n << 24n,
  CAN_TRANSFER: 1n << 28n, // only the admin form is used
  WAS_RESERVED: 1n << 32n,
  SET_URI: 1n << 36n,
  CAN_NAME: 1n << 120n,
  UPGRADE: 1n << 124n,
};

/** Resolver roles: PermissionedResolverLib.sol. */
export const RESOLVER_ROLES: Record<string, bigint> = {
  SET_ADDRESS: 1n << 0n,
  SET_TEXT: 1n << 4n,
  SET_CONTENTHASH: 1n << 8n,
  SET_ABI: 1n << 12n,
  SET_INTERFACE: 1n << 16n,
  SET_NAME: 1n << 20n,
  SET_DATA: 1n << 24n,
  LINK: 1n << 28n,
  CAN_NAME: 1n << 120n,
  UPGRADE: 1n << 124n,
};

/** EACBaseRolesLib.ALL_ROLES: bit 0 of every nybble. */
export const ALL_ROLES = BigInt("0x" + "1".repeat(64));

/** Human-readable names for a role bitmap ("SET_RESOLVER, SET_RESOLVER_ADMIN, …"). */
export function roleNames(bitmap: bigint, table: Record<string, bigint>): string[] {
  const out: string[] = [];
  for (const [name, bit] of Object.entries(table)) {
    if (bitmap & bit) out.push(name);
    if (bitmap & (bit << 128n)) out.push(`${name}_ADMIN`);
  }
  return out;
}

/** DNS wire format: "lifeboat.eth" -> 0x086c696665626f617403657468 00 */
export function dnsEncode(name: string): Hex {
  const parts = name.split(".").filter(Boolean);
  const bytes: number[] = [];
  for (const p of parts) {
    const b = new TextEncoder().encode(p);
    if (b.length > 63) throw new Error(`label too long: ${p}`);
    bytes.push(b.length, ...b);
  }
  bytes.push(0);
  return `0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

export const sepoliaClient = () => createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC(), { retryCount: 4, timeout: 30_000 }) });
/** Tenderly's public Sepolia gateway keeps full log history (20k results per query). */
export const sepoliaLogsClient = () => createPublicClient({ chain: sepolia, transport: http("https://sepolia.gateway.tenderly.co", { retryCount: 4, timeout: 60_000 }) });
export const mainnetClient = () => createPublicClient({ transport: http(envOr("MAINNET_RPC_URL", "https://ethereum-rpc.publicnode.com"), { retryCount: 3, timeout: 30_000 }) });

export function sepoliaDevWallet() {
  const raw = env("DEV_PRIVATE_KEY").trim().replace(/^["']|["']$/g, "");
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  const account = privateKeyToAccount(key);
  return { account, client: createWalletClient({ account, chain: sepolia, transport: http(SEPOLIA_RPC(), { retryCount: 4, timeout: 30_000 }) }) };
}

/**
 * Retries a send when a load-balanced public RPC answers from a stale backend (it hasn't seen a fresh
 * balance or nonce yet) or rate-limits us. Safe: in those cases the transaction was not accepted.
 */
export async function withStaleRetry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (i >= tries - 1 || !/insufficient funds|nonce too low|rate limit|429/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 4000 * (i + 1)));
    }
  }
}
