/**
 * Klien /api/v1 untuk frontend. Isomorfik:
 * - di server (server component): ke API_INTERNAL_URL (default http://127.0.0.1:4000)
 * - di browser: path relatif /api/v1 (satu domain; diproksikan Next.js / Caddy)
 */
import { unstable_rethrow } from "next/navigation";
import type { ApiError, Article, Candle, Holder, HoldersSnapshot, ListTokensParams, Page, PerpsDoc, Token, TraderRow, Trade, TrenchToken } from "./types";

const TIMEOUT_MS = 5000;

function base(): string {
  return typeof window === "undefined" ? (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000") : "";
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}/api/v1${path}`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(res.status, body?.error.code ?? "HTTP_ERROR", body?.error.message ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** Tab Discover "trenches" belum punya data FSM (langkah 9); sementara pakai daftar pool baru. */
const API_TAB = { "top-mc": "top-mc", trending: "trending", rwas: "rwas", trenches: "new" } as const;

export async function apiListTokens({ tab, chain = "all", timeframe = "24h", limit = 50 }: ListTokensParams): Promise<Token[]> {
  const qs = new URLSearchParams({ tab: API_TAB[tab], chain, timeframe, limit: String(Math.min(limit, 100)) });
  try {
    return (await get<Page<Token>>(`/tokens?${qs}`)).items;
  } catch (e) {
    unstable_rethrow(e); // sinyal internal Next.js (dynamic rendering, notFound) jangan ditelan
    // Halaman tetap tampil (kosong) bila api/worker belum jalan; error dicatat di log server.
    console.error(`[api] listTokens ${tab}/${chain}: ${(e as Error).message}`);
    return [];
  }
}

export async function apiGetToken(chain: string, address: string): Promise<Token | null> {
  try {
    return await get<Token>(tokenPath({ chain: chain as Token["chain"], address }));
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiRequestError && e.status < 500) return null; // 404/400 → halaman not found
    console.error(`[api] getToken ${chain}/${address}: ${(e as Error).message}`);
    return null;
  }
}

/** Hasil chart. `pending` = worker belum mengambil datanya (coba lagi ±10 dtk). */
export interface CandleSeries {
  items: Candle[];
  pending: boolean;
  /** Interval tidak tersedia dari sumber data sekarang (misal 1s/5s di Mode A). */
  unsupported: boolean;
  updatedAt: string | null;
}

/** intervalSec → nama interval API. */
const API_INTERVAL: Record<number, string> = { 1: "1s", 5: "5s", 60: "1m", 300: "5m", 900: "15m", 3600: "1h", 14400: "4h", 86400: "1d" };
type SeriesBody<T> = { items: T[]; pending: boolean; updatedAt: string | null };

const tokenPath = (t: Pick<Token, "chain" | "address">) => `/tokens/${encodeURIComponent(t.chain)}/${encodeURIComponent(t.address)}`;

export async function apiGetCandles(token: Token, intervalSec: number): Promise<CandleSeries> {
  const interval = API_INTERVAL[intervalSec];
  if (!interval) return { items: [], pending: false, unsupported: true, updatedAt: null };
  try {
    const r = await get<SeriesBody<Candle>>(`${tokenPath(token)}/ohlcv?interval=${interval}`);
    return { items: r.items, pending: r.pending, unsupported: false, updatedAt: r.updatedAt };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ApiRequestError && e.code === "INTERVAL_NOT_SUPPORTED") return { items: [], pending: false, unsupported: true, updatedAt: null };
    console.error(`[api] ohlcv ${token.chain}/${token.address} ${interval}: ${(e as Error).message}`);
    return { items: [], pending: false, unsupported: false, updatedAt: null };
  }
}

export async function apiGetTrades(token: Token): Promise<Trade[]> {
  try {
    return (await get<SeriesBody<Trade>>(`${tokenPath(token)}/trades?limit=100`)).items;
  } catch (e) {
    unstable_rethrow(e);
    console.error(`[api] trades ${token.chain}/${token.address}: ${(e as Error).message}`);
    return [];
  }
}

export interface SearchResult {
  tokens: Token[];
  /** Alamat valid yang belum ada di cache; worker sedang mengambilnya (cari ulang beberapa detik lagi). */
  pending: { chain: string; address: string }[];
}

/** Search token (langkah 4): GET /search — Meilisearch atau fallback Postgres di sisi api. */
export async function apiSearch(q: string, limit = 8): Promise<SearchResult> {
  const s = q.trim().slice(0, 100);
  if (!s) return { tokens: [], pending: [] };
  try {
    const r = await get<SearchResult>(`/search?${new URLSearchParams({ q: s, limit: String(limit) })}`);
    return { tokens: r.tokens ?? [], pending: r.pending ?? [] };
  } catch (e) {
    unstable_rethrow(e);
    return { tokens: [], pending: [] };
  }
}

export interface HoldersBody extends Omit<HoldersSnapshot, "source" | "updatedAt"> {
  source: string | null;
  updatedAt: string | null;
  stale: boolean;
  pending: boolean;
}

/** Top holder (langkah 7). Kosong + pending sampai worker selesai memindai (±10–30 dtk). */
export async function apiGetHolders(token: Token): Promise<Holder[]> {
  try {
    return (await get<HoldersBody>(`${tokenPath(token)}/holders`)).items;
  } catch (e) {
    unstable_rethrow(e);
    console.error(`[api] holders ${token.chain}/${token.address}: ${(e as Error).message}`);
    return [];
  }
}

/** Top traders (langkah 8). scope "global" atau "chain:address". Dari transaksi yang terpantau worker. */
export async function apiGetTopTraders(scope = "global"): Promise<TraderRow[]> {
  const qs = scope === "global" ? "" : `?token=${encodeURIComponent(scope)}`;
  try {
    return (await get<{ items: TraderRow[] }>(`/traders${qs}`)).items;
  } catch (e) {
    unstable_rethrow(e);
    console.error(`[api] traders ${scope}: ${(e as Error).message}`);
    return [];
  }
}

export interface TrenchesBody {
  items: TrenchToken[];
  counts: Record<string, number>;
  updatedAt: string | null;
  pending: boolean;
  stale: boolean;
}

/** Trenches (langkah 9). Chain tanpa worker Trenches → daftar kosong. */
export async function apiGetTrenches(chain: string): Promise<TrenchesBody> {
  try {
    return await get<TrenchesBody>(`/trenches/${encodeURIComponent(chain)}`);
  } catch (e) {
    unstable_rethrow(e);
    console.error(`[api] trenches ${chain}: ${(e as Error).message}`);
    return { items: [], counts: {}, updatedAt: null, pending: true, stale: true };
  }
}

/** Perps Hyperliquid (langkah 10). null = worker belum mengisi. */
export async function apiGetPerps(): Promise<PerpsDoc | null> {
  try {
    return (await get<{ perps: PerpsDoc | null }>("/perps")).perps;
  } catch (e) {
    unstable_rethrow(e);
    console.error(`[api] perps: ${(e as Error).message}`);
    return null;
  }
}

/** Artikel terbit dari CMS (langkah 12). null = CMS tidak tersedia. */
export async function apiListArticles(category?: Article["category"]): Promise<Article[] | null> {
  try {
    return (await get<{ items: Article[] }>(`/articles${category ? `?category=${category}` : ""}`)).items;
  } catch (e) {
    unstable_rethrow(e);
    console.error(`[api] articles: ${(e as Error).message}`);
    return null;
  }
}

export async function apiGetArticle(slug: string): Promise<Article | null> {
  try {
    return await get<Article>(`/articles/${encodeURIComponent(slug)}`);
  } catch (e) {
    unstable_rethrow(e);
    if (!(e instanceof ApiRequestError && e.status === 404)) console.error(`[api] article ${slug}: ${(e as Error).message}`);
    return null;
  }
}

/** Token resmi yang diatur admin di /admin (contract address untuk hero). null = belum diatur / API mati. */
export interface SiteToken {
  chain: string;
  address: string;
  symbol: string;
  buyUrl: string | null;
}
export async function apiGetSiteToken(): Promise<SiteToken | null> {
  try {
    return (await get<{ token: SiteToken | null }>("/site/token")).token;
  } catch (e) {
    unstable_rethrow(e);
    console.error(`[api] site token: ${(e as Error).message}`);
    return null;
  }
}
