/** Konversi jumlah & JSON-RPC. Semua jumlah on-chain disimpan sebagai string bilangan bulat (raw units). */

export type Fetch = typeof fetch;

export class SwapError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

/** "1.5" + 9 desimal → "1500000000". Digit di luar presisi dipotong. null bila format salah atau 0. */
export function parseUnits(amount: string, decimals: number): string | null {
  const m = /^(\d{1,30})(?:\.(\d{0,40}))?$/.exec(amount.trim());
  if (!m) return null;
  const frac = (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0");
  const v = BigInt(m[1] + frac);
  return v > 0n ? v.toString() : null;
}

/** "1500000000" + 9 → "1.5" */
export function formatUnits(raw: string | bigint, decimals: number): string {
  const v = BigInt(raw);
  const neg = v < 0n;
  const s = (neg ? -v : v).toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return (neg ? "-" : "") + int + (frac ? "." + frac : "");
}

const isUint = (s: unknown): s is string => typeof s === "string" && /^\d{1,78}$/.test(s);
export function uintStr(s: unknown, what: string): string {
  if (!isUint(s)) throw new SwapError(502, "AGGREGATOR_BAD_RESPONSE", `Respons aggregator tidak valid (${what})`);
  return s;
}

/** Label rute dari pihak ketiga: hanya karakter aman, pendek. */
export const cleanLabel = (s: unknown) => String(s ?? "").replace(/[^\w .+-]/g, "").slice(0, 30) || "?";

export async function getJson<T>(fetchImpl: Fetch, url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new SwapError(502, "UPSTREAM_UNAVAILABLE", "Aggregator/RPC tidak bisa dihubungi");
  }
  const body = (await res.json().catch(() => null)) as T | null;
  if (!res.ok || body === null) throw new SwapError(502, "UPSTREAM_ERROR", `Aggregator/RPC membalas HTTP ${res.status}`, body);
  return body;
}

let rpcId = 0;
export async function rpc<T>(fetchImpl: Fetch, url: string, method: string, params: unknown[]): Promise<T> {
  const body = await getJson<{ result?: T; error?: { code: number; message: string } }>(fetchImpl, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  if (body.error) throw new SwapError(502, "RPC_ERROR", `RPC ${method}: ${String(body.error.message).slice(0, 200)}`, body.error);
  return body.result as T;
}
