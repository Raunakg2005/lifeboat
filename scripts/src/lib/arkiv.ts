// Node-side Arkiv clients. Schemas live in @lifeboat/core (shared with the web app).
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "./env.js";

export { Aboard, CHECKER, EXPIRY, Exposure, Leaf, NameCheck, PUBLISHER } from "@lifeboat/core";

export const arkivChain = () => rabdi({ accessKey: env("ARKIV_ACCESS_KEY") });
export const arkivPublic = () => createPublicClient({ chain: arkivChain(), transport: http(undefined, { retryCount: 4, timeout: 30_000 }) });

/** The publisher's writer wallet (the dev wallet; its key stays in .env). */
export function arkivWallet() {
  const raw = env("DEV_PRIVATE_KEY").trim().replace(/^["']|["']$/g, "");
  const account = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
  return { account, client: createWalletClient({ chain: arkivChain(), transport: http(undefined, { retryCount: 4, timeout: 60_000 }), account }) };
}
