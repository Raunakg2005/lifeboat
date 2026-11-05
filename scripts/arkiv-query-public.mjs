// Runnable query for the public Q-Day registry on Arkiv. No access key, no .env needed:
//   pnpm install && node scripts/arkiv-query-public.mjs
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { and, eq } from "@arkiv-network/sdk/query";
import { http } from "viem";

const WRITER = "0xBAc277e47dd7B95c04BB3517b76c1dd9151A054a"; // Lifeboat publisher
const arkiv = createPublicClient({ chain: rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" }), transport: http() });

// exposed keys vouched for by the Lifeboat publisher
const { entities } = await arkiv
  .select({ $key: true, $expiresAt: true, $attributes: true })
  .where(and(eq("arkiv.schema", "lifeboat.exposure.v1"), eq("status", "exposed")))
  .ownedBy(WRITER)
  .limit(20)
  .fetch();

for (const e of entities) {
  const a = Object.fromEntries(Object.entries(e.$attributes).map(([k, v]) => [k, v.value]));
  console.log(`${a.address}  chain ${a.chainId}  ${a.ethAtRisk} ETH at risk  via ${a.via}  (entity ${e.$key.slice(0, 10)}…, expires at block ${e.$expiresAt})`);
}
console.log(`${entities.length} exposed key(s)`);
