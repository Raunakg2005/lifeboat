// The public Q-Day registry on Arkiv: schemas (browser-safe). Documented in arkiv/schema.md.
import { ExpirationTime } from "@arkiv-network/sdk";
import { addr, dec, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";

/** One address on one chain, as checked at one block. Short-lived: re-checked. */
export const Exposure = defineSchema("lifeboat.exposure.v1", {
  address: addr().indexed(),
  chainId: u64().indexed(),
  status: str().indexed(), // exposed | not-seen | pq | contract
  via: str().indexed(), // nonce | safe-signature | ens-control | ...
  ethAtRisk: dec().indexed(),
  checkedBlock: u64(),
  evidence: str(),
  checker: str(),
  swarmRef: str().optional(),
});

/** A verified move from an exposed key to a post-quantum account. Audit trail. */
export const Aboard = defineSchema("lifeboat.aboard.v1", {
  from: addr().indexed(),
  to: addr().indexed(),
  chainId: u64().indexed(),
  kind: str().indexed(), // rescue-sweep | ens-handover | pq-account
  scheme: str().indexed(),
  root: str(),
  txHash: str(),
  note: str(),
  swarmRef: str().optional(),
});

/** Leaf ledger: one entry per use (or sighting) of a one-time WOTS+C leaf. Readonly, anyone can extend. */
export const Leaf = defineSchema("lifeboat.leaf.v1", {
  root: str().indexed(),
  leaf: u64().indexed(),
  account: addr().indexed(),
  chainId: u64().indexed(),
  digest: str(),
  txHash: str(),
});

/** ENSv2 Helm check verdict for one name at one block. */
export const NameCheck = defineSchema("lifeboat.name.v1", {
  name: str().indexed(),
  chainId: u64().indexed(),
  verdict: str().indexed(), // hijackable | protected | unknown
  owner: addr().indexed(),
  paths: str(),
  checkedBlock: u64(),
  swarmRef: str().optional(),
});

export const EXPIRY = {
  exposure: () => ExpirationTime.fromHours(24),
  name: () => ExpirationTime.fromHours(24),
  aboard: () => ExpirationTime.fromDays(180),
  leaf: () => ExpirationTime.fromDays(180),
};

export const CHECKER = "lifeboat-publisher/0.1";
export const PUBLISHER = "0xBAc277e47dd7B95c04BB3517b76c1dd9151A054a" as const;
export const ARKIV_BLOCK_SECONDS = 2;
