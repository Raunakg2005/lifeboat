# Arkiv friction log

Real friction we hit, logged as it happened. Format: what we tried → what we expected → what happened → how to reproduce → suggestion.

## 1. Public RPC briefly unreachable (5 Nov 2026, ~20:53 IST)

- **Tried:** `eth_blockNumber` / `eth_getBalance` on `https://rpc.rabdi.db-chain.testnet.arkiv.network`.
- **Expected:** a JSON-RPC reply.
- **Happened:** Cloudflare HTTP 522 (origin not reachable) for a few minutes. It was back by 20:58. The chain kept producing blocks (252,006 at 20:15 → 253,389 at 20:58), so only the RPC front end was down.
- **Reproduce:** not reproducible now; it was transient.
- **Suggestion:** a status page or a second public RPC endpoint to fail over to during hackathons. On our side, every Arkiv call now has retries and a timeout.
