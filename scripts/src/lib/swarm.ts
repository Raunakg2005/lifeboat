// Small Bee client: upload a named file with the usable postage batch, read it back, check the public gateway.
export const BEE = () => process.env.BEE_API_URL || "http://127.0.0.1:1633";
export const SWARM_GATEWAY = "https://api.gateway.testnet.ethswarm.org";

async function bee(path: string, init?: RequestInit) {
  const r = await fetch(BEE() + path, { ...init, signal: AbortSignal.timeout(120_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Bee ${init?.method ?? "GET"} ${path}: HTTP ${r.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function usableBatch(): Promise<{ batchID: string; batchTTL: number; depth: number }> {
  const stamps = ((await bee("/stamps")).stamps ?? []) as any[];
  const b = stamps.find((s) => s.usable && Number(s.batchTTL) > 3600);
  if (!b) throw new Error("no usable postage batch: run swarm-publish to buy one");
  return b;
}

/** Uploads bytes as a named file; verifies the local read-back byte for byte. Returns the reference. */
export async function uploadFile(name: string, body: Uint8Array, contentType = "application/json"): Promise<string> {
  const batch = await usableBatch();
  const res = await bee(`/bzz?name=${encodeURIComponent(name)}`, { method: "POST", headers: { "content-type": contentType, "swarm-postage-batch-id": batch.batchID }, body: Buffer.from(body) });
  const ref = res.reference as string;
  const resp = await fetch(`${BEE()}/bzz/${ref}/`);
  const back = new Uint8Array((await resp.arrayBuffer()) as ArrayBuffer);
  if (back.length !== body.length || back.some((b, i) => b !== body[i])) throw new Error(`${name}: local read-back differs`);
  return ref;
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
