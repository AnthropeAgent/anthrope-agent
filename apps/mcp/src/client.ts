/**
 * Klien tipis untuk Data API Anthrope Agent. Semua permintaan memakai API key `ak_…` milik pengguna
 * (header x-api-key) dan hanya membaca data; server MCP ini tidak pernah menandatangani atau mengirim transaksi.
 */
export interface ApiConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const baseUrl = (env.ANTHROPE_API_URL ?? "http://localhost:4000/api/v1").replace(/\/+$/, "");
  return { baseUrl, apiKey: env.ANTHROPE_API_KEY || undefined, timeoutMs: Number(env.ANTHROPE_TIMEOUT_MS ?? 15000) };
}

export function buildUrl(cfg: ApiConfig, path: string, query: Record<string, string | number | boolean | undefined> = {}) {
  const url = new URL(cfg.baseUrl + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  return url;
}

export async function apiGet<T = unknown>(cfg: ApiConfig, path: string, query?: Record<string, string | number | boolean | undefined>, fetchImpl: typeof fetch = fetch): Promise<T> {
  const res = await fetchImpl(buildUrl(cfg, path, query), {
    headers: { accept: "application/json", ...(cfg.apiKey ? { "x-api-key": cfg.apiKey } : {}) },
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 15000),
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } | string; message?: string };
      const m = typeof body.error === "string" ? body.error : (body.error?.message ?? body.message);
      if (m) msg = `${res.status}: ${m}`;
    } catch {
      /* body bukan JSON */
    }
    if (res.status === 401) msg += " — set ANTHROPE_API_KEY (buat di halaman Data API).";
    if (res.status === 429) msg += " — batas kredit/detik paket API tercapai, coba lagi sebentar.";
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}
