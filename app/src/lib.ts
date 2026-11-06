import { createPublicClient as arkivPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { PUBLIC_RPC, TENDERLY_MAINNET } from "@lifeboat/core";
import sepoliaDeployments from "../../deployments/sepolia.json";

export const SEPOLIA_PQ_WALLETS = [sepoliaDeployments.pqWallet] as `0x${string}`[];
export const REPO = "https://github.com/Raunakg2005/lifeboat";

export const sepoliaClient = createPublicClient({ chain: sepolia, transport: http(PUBLIC_RPC.sepolia, { retryCount: 3, timeout: 30_000 }) }) as PublicClient;
export const sepoliaLogs = createPublicClient({ chain: sepolia, transport: http(PUBLIC_RPC.sepoliaLogs, { retryCount: 3, timeout: 60_000 }) }) as PublicClient;
// Safe deep scan: batched mainnet reads, and Tenderly's public gateway for full-range logs
export const safeClient = createPublicClient({ chain: mainnet, transport: http(PUBLIC_RPC.mainnet, { retryCount: 3, timeout: 30_000, batch: { batchSize: 50 } }) }) as PublicClient;
export const safeLogs = createPublicClient({ chain: mainnet, transport: http(TENDERLY_MAINNET, { retryCount: 3, timeout: 60_000 }) }) as PublicClient;
export const mainnetClient = createPublicClient({ chain: mainnet, transport: http(PUBLIC_RPC.mainnet, { retryCount: 2, timeout: 20_000 }) }) as PublicClient;

// Arkiv reads work without a key (rate-limited public endpoint). The key, if set, is a public browser key.
export const arkiv = arkivPublicClient({ chain: rabdi({ accessKey: import.meta.env.VITE_ARKIV_ACCESS_KEY ?? "" }), transport: http() });

export const short = (a: string, n = 6) => (a.length > 2 * n + 2 ? `${a.slice(0, n + 2)}…${a.slice(-n + 2)}` : a);
export const explorerTx = (h: string) => `https://explorer.altmempool.wtf/tx/${h}?node=${encodeURIComponent("https://altmempoolgateway.forshtat.com/rpc")}`;
export const sepoliaTx = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;
export const sepoliaAddr = (a: string) => `https://sepolia.etherscan.io/address/${a}`;

export const SWARM_GATEWAY = "https://api.gateway.testnet.ethswarm.org";
export const swarmUrl = (ref: string) => `${SWARM_GATEWAY}/bzz/${ref}/`;
