// Node-side ENS helpers: the shared ENSv2 constants come from @lifeboat/core; this adds env-based clients.
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { PUBLIC_RPC, RPCS, rpcTransport } from "@lifeboat/core";
import { env, envOr } from "./env.js";

export * from "@lifeboat/core";

export const SEPOLIA_RPC = () => envOr("SEPOLIA_RPC_URL", PUBLIC_RPC.sepolia);

export const sepoliaClient = () => createPublicClient({ chain: sepolia, batch: { multicall: true }, transport: rpcTransport([SEPOLIA_RPC(), ...RPCS.sepolia]) });
export const sepoliaLogsClient = () => createPublicClient({ chain: sepolia, transport: rpcTransport(RPCS.sepoliaLogs, { timeout: 60_000 }) });
export const mainnetClient = () => createPublicClient({ transport: rpcTransport([envOr("MAINNET_RPC_URL", PUBLIC_RPC.mainnet), ...RPCS.mainnet]) });

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
