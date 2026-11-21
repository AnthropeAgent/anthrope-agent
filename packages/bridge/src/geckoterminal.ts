/**
 * Adapter GeckoTerminal (API publik gratis, tanpa key):
 * - DISCOVERY: daftar pool trending / top / baru per chain.
 * - OHLCV & trades per pool, hanya untuk token yang sedang dibuka user.
 * Limit publik ±10 panggilan/menit untuk SEMUA panggilan di atas, jadi satu limiter dipakai bersama.
 */
import { BRIDGE_CHAINS, isValidAddress, normAddress, type BridgeChain } from "./chains";
import { fetchJson, RateLimiter } from "./http";
import type { Candle, Trade } from "@ot/types";
import { cleanText, cleanUrl, num } from "./sanitize";

const BASE = "https://api.geckoterminal.com/api/v2";
const HEADERS = { accept: "application/json;version=20230302" };
const limiter = new RateLimiter(6_500); // ≤ ~9 panggilan/menit

export type GtList = "trending" | "top" | "new";
const PATH: Record<GtList, string> = { trending: "trending_pools", top: "pools", new: "new_pools" };

/** Satu pool dari GeckoTerminal, sudah dinormalisasi ke sudut pandang base token. */
export interface GtPool {
  chain: BridgeChain;
  poolAddress: string;
  dex: string;
  token: { address: string; symbol: string; name: string; decimals: number | null; imageUrl?: string };
  priceUsd: number | null;
  priceNative: number | null;
  fdv: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  change: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  buys24h: number | null;
  sells24h: number | null;
  traders24h: number | null;
  createdAt: number | null; // ms
}

// Bentuk mentah (hanya field yang dipakai)
interface RawResource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data?: { id: string; type: string } | null }>;
}
interface RawList {
  data?: RawResource[];
  included?: RawResource[];
}

function stripId(network: string, id: string | undefined): string {
  return id?.startsWith(`${network}_`) ? id.slice(network.length + 1) : (id ?? "");
}

type Win = Record<string, unknown> | undefined;
const pick = (o: unknown, k: string): unknown => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined);

/** Pure: ubah respons list pool → GtPool[]. Diekspor untuk tes. */
export function parsePools(chain: BridgeChain, raw: RawList): GtPool[] {
  const network = BRIDGE_CHAINS[chain].gt;
  const tokens = new Map((raw.included ?? []).filter((r) => r.type === "token").map((r) => [r.id, r.attributes]));
  const out: GtPool[] = [];
  for (const p of raw.data ?? []) {
    const a = p.attributes;
    const baseId = p.relationships?.base_token?.data?.id;
    const t = baseId ? tokens.get(baseId) : undefined;
    const address = cleanText(t?.address ?? stripId(network, baseId), 100);
    if (!address) continue;
    const tx24 = pick(a.transactions, "h24") as Win;
    const vol = a.volume_usd;
    const ch = a.price_change_percentage;
    const name = cleanText(t?.name ?? String(a.name ?? "").split(" / ")[0], 80);
    out.push({
      chain,
      poolAddress: cleanText(a.address, 100),
      dex: cleanText(stripId(network, p.relationships?.dex?.data?.id) || p.relationships?.dex?.data?.id, 40),
      token: {
        address: normAddress(chain, address),
        symbol: cleanText(t?.symbol ?? name, 24) || "?",
        name: name || "Unknown",
        decimals: num(t?.decimals),
        imageUrl: cleanUrl(t?.image_url),
      },
      priceUsd: num(a.base_token_price_usd),
      priceNative: num(a.base_token_price_native_currency),
      fdv: num(a.fdv_usd),
      marketCap: num(a.market_cap_usd),
      liquidityUsd: num(a.reserve_in_usd),
      volume24h: num(pick(vol, "h24")),
      change: { m5: num(pick(ch, "m5")), h1: num(pick(ch, "h1")), h6: num(pick(ch, "h6")), h24: num(pick(ch, "h24")) },
      buys24h: num(pick(tx24, "buys")),
      sells24h: num(pick(tx24, "sells")),
      traders24h: num(pick(tx24, "unique_traders")),
      createdAt: typeof a.pool_created_at === "string" ? Date.parse(a.pool_created_at) || null : null,
    });
  }
  return out;
}

export async function listPools(chain: BridgeChain, list: GtList, page = 1): Promise<GtPool[]> {
  const network = BRIDGE_CHAINS[chain].gt;
  const url = `${BASE}/networks/${network}/${PATH[list]}?include=base_token&page=${page}`;
  const raw = await fetchJson<RawList>(url, { provider: "geckoterminal", limiter, headers: HEADERS });
  return parsePools(chain, raw);
}

/** Pool satu DEX (mis. pump-fun, pumpswap) diurutkan aktivitas 24 jam (langkah 9, Trenches). */
export async function dexPools(chain: BridgeChain, dex: string, sort: "h24_tx_count_desc" | "h24_volume_usd_desc" = "h24_tx_count_desc", page = 1): Promise<GtPool[]> {
  const network = BRIDGE_CHAINS[chain].gt;
  if (!/^[a-z0-9-]{2,40}$/.test(dex)) throw new Error("dex id tidak valid");
  const url = `${BASE}/networks/${network}/dexes/${dex}/pools?include=base_token&sort=${sort}&page=${page}`;
  const raw = await fetchJson<RawList>(url, { provider: "geckoterminal", limiter, headers: HEADERS });
  return parsePools(chain, raw);
}

// ---------- OHLCV & trades per pool (dipakai worker untuk token yang sedang dibuka user) ----------

/** Interval chart yang bisa dilayani GeckoTerminal (tidak ada resolusi detik di API publik). */
export const GT_INTERVALS = {
  "1m": { timeframe: "minute", aggregate: 1, sec: 60 },
  "5m": { timeframe: "minute", aggregate: 5, sec: 300 },
  "15m": { timeframe: "minute", aggregate: 15, sec: 900 },
  "1h": { timeframe: "hour", aggregate: 1, sec: 3600 },
  "4h": { timeframe: "hour", aggregate: 4, sec: 14_400 },
  "1d": { timeframe: "day", aggregate: 1, sec: 86_400 },
} as const;
export type GtInterval = keyof typeof GT_INTERVALS;
export const isGtInterval = (s: string): s is GtInterval => Object.hasOwn(GT_INTERVALS, s);

const CANDLE_LIMIT = 300;

/** Pure: ohlcv_list ([t,o,h,l,c,v], terbaru dulu) → Candle[] urut waktu naik, tanpa bar rusak. */
export function parseOhlcv(raw: unknown): Candle[] {
  const list = pick(pick(pick(raw, "data"), "attributes"), "ohlcv_list");
  if (!Array.isArray(list)) return [];
  const out: Candle[] = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [time, open, high, low, close, volume] = row.map((x) => num(x));
    if (time == null || open == null || high == null || low == null || close == null) continue;
    if (open <= 0 || close <= 0 || high < low) continue;
    out.push({ time: Math.floor(time), open, high, low, close, volume: volume ?? 0 });
  }
  out.sort((a, b) => a.time - b.time);
  return out.filter((c, i) => i === 0 || c.time !== out[i - 1].time);
}

/** Harga dalam USD dari sudut pandang `tokenAddress` (bukan base pool). */
export async function poolOhlcv(chain: BridgeChain, pool: string, tokenAddress: string, interval: GtInterval): Promise<Candle[]> {
  const { timeframe, aggregate } = GT_INTERVALS[interval];
  const network = BRIDGE_CHAINS[chain].gt;
  const qs = new URLSearchParams({ aggregate: String(aggregate), limit: String(CANDLE_LIMIT), currency: "usd", token: tokenAddress });
  const url = `${BASE}/networks/${network}/pools/${encodeURIComponent(pool)}/ohlcv/${timeframe}?${qs}`;
  return parseOhlcv(await fetchJson<unknown>(url, { provider: "geckoterminal", limiter, headers: HEADERS }));
}

/**
 * Pure: trade pool → Trade[] untuk token tertentu. Sisi beli/jual dihitung sendiri dari arah token
 * (field `kind` GeckoTerminal relatif ke base pool, jadi tidak dipakai). Trade anomali dibuang.
 */
export function parseTrades(chain: BridgeChain, tokenAddress: string, raw: unknown): Trade[] {
  const data = pick(raw, "data");
  if (!Array.isArray(data)) return [];
  const token = normAddress(chain, tokenAddress);
  const out: Trade[] = [];
  for (const r of data) {
    const a = pick(r, "attributes") as Record<string, unknown> | undefined;
    if (!a || a.is_anomalous === true) continue;
    const from = normAddress(chain, cleanText(a.from_token_address, 100));
    const to = normAddress(chain, cleanText(a.to_token_address, 100));
    const side = to === token ? "buy" : from === token ? "sell" : null;
    if (!side) continue;
    const amountToken = num(side === "buy" ? a.to_token_amount : a.from_token_amount);
    const priceUsd = num(side === "buy" ? a.price_to_in_usd : a.price_from_in_usd);
    const valueUsd = num(a.volume_in_usd);
    const txHash = cleanText(a.tx_hash, 100);
    const maker = cleanText(a.tx_from_address, 100);
    const time = typeof a.block_timestamp === "string" ? Math.floor(Date.parse(a.block_timestamp) / 1000) : NaN;
    if (amountToken == null || priceUsd == null || valueUsd == null || !txHash || !maker || !Number.isFinite(time)) continue;
    if (!isValidAddress(chain, maker)) continue;
    // id GeckoTerminal: {network}_{block}_{tx}_{logIndex}_{ts}; ambil logIndex supaya unik per event
    const logIndex = String(pick(r, "id") ?? "").split("_")[3] ?? "0";
    out.push({ id: `${chain}:${txHash}:${cleanText(logIndex, 12) || "0"}`, time, side, priceUsd, amountToken, valueUsd, maker, txHash, final: true });
  }
  return out.sort((x, y) => y.time - x.time);
}

/** Maks 300 trade terakhir dalam 24 jam (batas API publik). */
export async function poolTrades(chain: BridgeChain, pool: string, tokenAddress: string): Promise<Trade[]> {
  const network = BRIDGE_CHAINS[chain].gt;
  const url = `${BASE}/networks/${network}/pools/${encodeURIComponent(pool)}/trades?token=${encodeURIComponent(tokenAddress)}`;
  return parseTrades(chain, tokenAddress, await fetchJson<unknown>(url, { provider: "geckoterminal", limiter, headers: HEADERS }));
}
