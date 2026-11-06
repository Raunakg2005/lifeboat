// Node-side Arkiv clients. Schemas live in @lifeboat/core (shared with the web app).
// Reads need no key: without ARKIV_ACCESS_KEY the public (rate-limited) Rabdi endpoint is used, and without
// DEV_PRIVATE_KEY the scripts get a read-only client. Only writes need the dev wallet's key.
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PUBLISHER } from "@lifeboat/core";
import { env } from "./env.js";

export { Aboard, Alert, CHECKER, EXPIRY, Exposure, Leaf, NameCheck, PUBLISHER, Watch } from "@lifeboat/core";

const accessKey = () => process.env.ARKIV_ACCESS_KEY?.trim() ?? "";
export const arkivChain = () => rabdi({ accessKey: accessKey() });
export const arkivPublic = () => createPublicClient({ chain: arkivChain(), transport: http(undefined, { retryCount: 4, timeout: 30_000 }) });

/** True when a writer key is configured. Nothing is read from disk here: tsx's --env-file loads .env, or not. */
export const hasWriterKey = () => Boolean(process.env.DEV_PRIVATE_KEY?.trim());

/** The publisher's writer wallet (the dev wallet; its key stays in .env). */
export function arkivWallet() {
  const raw = env("DEV_PRIVATE_KEY").trim().replace(/^["']|["']$/g, "");
  const account = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
  return { account, client: createWalletClient({ chain: arkivChain(), transport: http(undefined, { retryCount: 4, timeout: 60_000 }), account }) };
}

/**
 * A client for whatever this process may do: the writer wallet when DEV_PRIVATE_KEY is set, a read-only
 * public client otherwise. `owner` is whose entities to look at (the writer, or the Lifeboat publisher).
 */
export function arkivClient():
  | { readOnly: false; owner: Address; reader: ReturnType<typeof arkivPublic>; writer: ReturnType<typeof arkivWallet> }
  | { readOnly: true; owner: Address; reader: ReturnType<typeof arkivPublic>; writer: null } {
  const reader = arkivPublic();
  if (!hasWriterKey()) return { readOnly: true, owner: PUBLISHER, reader, writer: null };
  const writer = arkivWallet();
  return { readOnly: false, owner: writer.account.address, reader, writer };
}
