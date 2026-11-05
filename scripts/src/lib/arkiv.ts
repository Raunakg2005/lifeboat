// The public Q-Day registry on Arkiv (Rabdi testnet): schemas and clients.
// Schemas are documented in arkiv/schema.md; keep both in sync.
import { createPublicClient, createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { addr, dec, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";
import { http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "./env.js";

/** One address on one chain, as checked at one block. Short-lived: exposure changes, so it is re-checked. */
export const Exposure = defineSchema("lifeboat.exposure.v1", {
  address: addr().indexed(),
  chainId: u64().indexed(),
  status: str().indexed(), // exposed | not-seen | pq | contract
  via: str().indexed(), // how we know: nonce | safe-signature | ens-control | ...
  ethAtRisk: dec().indexed(),
  checkedBlock: u64(),
  evidence: str(), // tx hash, or a short proof note (<= 128 bytes)
  checker: str(),
  swarmRef: str().optional(), // evidence bundle on Swarm
});

/** A verified move from an exposed key to a post-quantum account ("aboard the lifeboat"). Kept as an audit trail. */
export const Aboard = defineSchema("lifeboat.aboard.v1", {
  from: addr().indexed(),
  to: addr().indexed(),
  chainId: u64().indexed(),
  kind: str().indexed(), // rescue-sweep | ens-handover | pq-account
  scheme: str().indexed(), // WOTS+C-keccak-w16-S560-h8
  root: str(), // the PQ key commitment
  txHash: str(),
  note: str(),
  swarmRef: str().optional(),
});

/**
 * Leaf ledger: one entry per use of a one-time WOTS+C leaf. Readonly (nobody can edit history) and
 * permissionlessExtension (anyone can keep it alive). Anyone may publish a sighting, e.g. a watcher
 * that saw a leaf in a mempool, so two entries for one (root, leaf) with different digests means the
 * key signed twice: a forgery risk.
 */
export const Leaf = defineSchema("lifeboat.leaf.v1", {
  root: str().indexed(), // which key
  leaf: u64().indexed(),
  account: addr().indexed(),
  chainId: u64().indexed(),
  digest: str(), // what the leaf signed
  txHash: str(),
});

/** ENSv2 Helm check verdict for one name at one block. */
export const NameCheck = defineSchema("lifeboat.name.v1", {
  name: str().indexed(),
  chainId: u64().indexed(),
  verdict: str().indexed(), // hijackable | protected | unknown
  owner: addr().indexed(),
  paths: str(), // owner-controllable paths with an exposed holder, e.g. "1,2,3,4"
  checkedBlock: u64(),
  swarmRef: str().optional(),
});

export const EXPIRY = {
  exposure: () => ExpirationTime.fromHours(24),
  name: () => ExpirationTime.fromHours(24),
  aboard: () => ExpirationTime.fromDays(180),
  leaf: () => ExpirationTime.fromDays(180),
};

export const arkivChain = () => rabdi({ accessKey: env("ARKIV_ACCESS_KEY") });
export const arkivPublic = () => createPublicClient({ chain: arkivChain(), transport: http(undefined, { retryCount: 4, timeout: 30_000 }) });

/** The publisher's writer wallet (the dev wallet; its key stays in .env). */
export function arkivWallet() {
  const raw = env("DEV_PRIVATE_KEY").trim().replace(/^["']|["']$/g, "");
  const account = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
  return { account, client: createWalletClient({ chain: arkivChain(), transport: http(undefined, { retryCount: 4, timeout: 60_000 }), account }) };
}

export const CHECKER = "lifeboat-publisher/0.1";
