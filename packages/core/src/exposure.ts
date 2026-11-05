// Address exposure across chains: an EOA's public key is on-chain once it has sent a transaction.
// (Hidden exposure through Safe signatures, votes and orders is the deep scan; this is the fast check.)
import { createPublicClient, formatEther, http, type Address } from "viem";

export interface ChainInfo {
  id: number;
  name: string;
  rpc: string;
  symbol: string;
}

/** CORS-enabled public RPCs. */
export const CHAINS: ChainInfo[] = [
  { id: 1, name: "Ethereum", rpc: "https://ethereum-rpc.publicnode.com", symbol: "ETH" },
  { id: 8453, name: "Base", rpc: "https://base-rpc.publicnode.com", symbol: "ETH" },
  { id: 42161, name: "Arbitrum", rpc: "https://arbitrum-one-rpc.publicnode.com", symbol: "ETH" },
  { id: 10, name: "Optimism", rpc: "https://optimism-rpc.publicnode.com", symbol: "ETH" },
  { id: 137, name: "Polygon", rpc: "https://polygon-bor-rpc.publicnode.com", symbol: "POL" },
  { id: 11155111, name: "Sepolia", rpc: "https://ethereum-sepolia-rpc.publicnode.com", symbol: "ETH" },
];

export interface ChainExposure {
  chain: ChainInfo;
  nonce: number;
  balance: string;
  isContract: boolean;
  status: "exposed" | "not-seen" | "contract" | "error";
  error?: string;
}

export async function checkExposure(address: Address, chains: ChainInfo[] = CHAINS): Promise<ChainExposure[]> {
  return Promise.all(
    chains.map(async (chain) => {
      try {
        const c = createPublicClient({ transport: http(chain.rpc, { timeout: 15_000, retryCount: 2 }) });
        const [nonce, bal, code] = await Promise.all([c.getTransactionCount({ address }), c.getBalance({ address }), c.getCode({ address })]);
        const isContract = !!code && code !== "0x";
        return { chain, nonce, balance: formatEther(bal), isContract, status: isContract ? "contract" : nonce > 0 ? "exposed" : "not-seen" } as ChainExposure;
      } catch (e) {
        return { chain, nonce: 0, balance: "0", isContract: false, status: "error", error: String((e as Error).message).slice(0, 120) } as ChainExposure;
      }
    }),
  );
}
