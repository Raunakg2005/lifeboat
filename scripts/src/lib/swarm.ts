// Small Bee client: upload a named file with the usable postage batch, read it back, check the public gateway,
// and the read-only health checks the Monitor uses (batch TTL, stewardship).
import { keccak256, type Hex } from "viem";

export const BEE = () => process.env.BEE_API_URL || "http://127.0.0.1:1633";
export const SWARM_GATEWAY = "https://api.gateway.testnet.ethswarm.org";

export async function bee(path: string, init?: RequestInit & { timeoutMs?: number }) {
  const r = await fetch(BEE() + path, { ...init, signal: AbortSignal.timeout(init?.timeoutMs ?? 120_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Bee ${init?.method ?? "GET"} ${path}: HTTP ${r.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** keccak256 of the exact bytes stored on Swarm: the `evidenceHash` column on Arkiv. */
export const evidenceHash = (bytes: Uint8Array): Hex => keccak256(bytes);

/** The bytes a JSON evidence file is written and uploaded as (bigints as decimal strings, 2-space indent). */
export const jsonBytes = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));

/** GET /health with a short timeout; null when the node isn't reachable. */
export async function beeHealth(): Promise<{ status: string; version: string } | null> {
  try {
    return await bee("/health", { timeoutMs: 5_000 });
  } catch {
    return null;
  }
}

export type Stamp = { batchID: string; batchTTL: number; depth: number; usable: boolean; utilization?: number; exists?: boolean; txHash?: string };

export async function stamps(): Promise<Stamp[]> {
  return (((await bee("/stamps", { timeoutMs: 15_000 })).stamps ?? []) as any[]).map((s) => ({ ...s, batchTTL: Number(s.batchTTL) }));
}

/** The usable batch with the most time left (at least `minTTL` seconds and `minDepth`), or null. */
export async function findBatch(minDepth = 0, minTTL = 3600): Promise<Stamp | null> {
  const ok = (await stamps()).filter((s) => s.usable && s.depth >= minDepth && s.batchTTL > minTTL);
  return ok.sort((a, b) => b.batchTTL - a.batchTTL)[0] ?? null;
}

export async function usableBatch(): Promise<Stamp> {
  const b = await findBatch();
  if (!b) throw new Error("no usable postage batch: run swarm-publish to buy one");
  return b;
}

/** GET /stewardship/<ref>: can the network still serve every chunk of the reference? */
export async function isRetrievable(ref: string): Promise<boolean> {
  return Boolean((await bee(`/stewardship/${ref}`, { timeoutMs: 90_000 })).isRetrievable);
}

export type Uploaded = { reference: string; evidenceHash: Hex; bytes: number };

/**
 * Uploads bytes as a named file, pinned on our node and pushed to the network before Bee answers
 * (swarm-deferred-upload: false). Verifies the local read-back byte for byte and by keccak256.
 */
export async function uploadFile(name: string, body: Uint8Array, contentType = "application/json", batchID?: string): Promise<Uploaded> {
  const batch = batchID ?? (await usableBatch()).batchID;
  const res = await bee(`/bzz?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "content-type": contentType, "swarm-postage-batch-id": batch, "swarm-pin": "true", "swarm-deferred-upload": "false" },
    body: Buffer.from(body),
  });
  const reference = res.reference as string;
  const resp = await fetch(`${BEE()}/bzz/${reference}/`, { signal: AbortSignal.timeout(120_000) });
  const back = new Uint8Array((await resp.arrayBuffer()) as ArrayBuffer);
  const hash = evidenceHash(body);
  if (back.length !== body.length || back.some((b, i) => b !== body[i]) || evidenceHash(back) !== hash) throw new Error(`${name}: local read-back differs`);
  return { reference, evidenceHash: hash, bytes: body.length };
}

/** Polls the public gateway until the reference opens (chunks need a moment to spread). */
export async function gatewayOpens(ref: string, tries = 12): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(`${SWARM_GATEWAY}/bzz/${ref}/`, { signal: AbortSignal.timeout(30_000) })).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return false;
}
