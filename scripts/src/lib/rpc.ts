// JSON-RPC with timeouts and retries: the venue network drops DNS lookups now and then.
export class RpcCallError extends Error {
  constructor(
    readonly method: string,
    readonly url: string,
    readonly code: number | string,
    message: string,
    readonly data?: unknown,
  ) {
    super(`${method} @ ${new URL(url).host}: ${message}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function rpc<T = any>(url: string, method: string, params: unknown[] = [], opts: { retries?: number; timeoutMs?: number } = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }, (_, v) => (typeof v === "bigint" ? `0x${v.toString(16)}` : v)),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
      const text = await res.text();
      let body: any;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
      }
      if (body.error) throw new RpcCallError(method, url, body.error.code, body.error.message, body.error.data);
      return body.result as T;
    } catch (e) {
      if (e instanceof RpcCallError) throw e; // the node answered: don't retry
      lastErr = e;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    }
  }
  throw new Error(`${method} @ ${new URL(url).host} unreachable after ${retries + 1} tries: ${String((lastErr as Error)?.message ?? lastErr)}`);
}
