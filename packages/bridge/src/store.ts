/**
 * Store Redis untuk data pasar panas. Worker = satu-satunya penulis; api hanya membaca.
 * Hanya memakai perintah string dasar (SET/GET/MGET/DEL/KEYS) supaya jalan juga di devdb.
 *
 *   tok:{chain}:{addr}        JSON Token, TTL 1 hari
 *   list:{chain|all}:{tab}    JSON string[] key token ("chain:addr"), urutan tampil
 *   known:{chain}             JSON {addr: lastSeenMs}, token yang di-refresh worker
 *   want:{chain}:{addr}       permintaan token yang belum di-cache (dari api), TTL 10 menit
 *   bridge:status             JSON status siklus worker terakhir
 *   ohlcv:{chain}:{addr}:{iv} JSON Series<Candle>, TTL 1 hari
 *   trades:{chain}:{addr}     JSON Series<Trade>, TTL 1 hari
 *   traders:{all|chain:addr}  JSON {items: TraderRow[], updatedAt} (langkah 8), TTL 1 hari
 *   wallet:{addr}             JSON WalletProfile (langkah 8), TTL 1 hari
 *   view:{kind}:{chain}:{addr} token/wallet yang sedang dibuka user (kind = trades | ohlcv-{iv} | holders | wallet); TTL pendek,
 *                             diperpanjang tiap request api. Worker me-refresh data selama key ini hidup.
 */
import { redis } from "@ot/db";
import type { Candle, Token, TraderRow, Trade, TrenchToken, PerpsDoc, WalletProfile } from "@ot/types";
import type { Redis } from "ioredis";

export type ListTab = "trending" | "top-mc" | "new";
export const TOKEN_TTL_SEC = 86_400;
const WANT_TTL_SEC = 600;
const VIEW_TTL_SEC = 90;

export class StoreUnavailableError extends Error {
  constructor() {
    super("redis tidak dikonfigurasi atau tidak bisa dihubungi");
  }
}

async function client(): Promise<Redis> {
  const r = redis();
  if (!r) throw new StoreUnavailableError();
  if (r.status === "wait") await r.connect().catch(() => undefined);
  if (r.status !== "ready") throw new StoreUnavailableError();
  return r;
}

export const tokenKey = (chain: string, address: string) => `${chain}:${address}`;

function parse<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

// ---------- baca (api) ----------
export async function getToken(chain: string, address: string): Promise<Token | null> {
  return parse<Token>(await (await client()).get(`tok:${chain}:${address}`));
}

export async function getTokens(keys: string[]): Promise<Token[]> {
  if (!keys.length) return [];
  const raw = await (await client()).mget(keys.map((k) => `tok:${k}`));
  return raw.map((s) => parse<Token>(s)).filter((t): t is Token => t !== null);
}

export async function getList(scope: string, tab: ListTab): Promise<string[]> {
  return parse<string[]>(await (await client()).get(`list:${scope}:${tab}`)) ?? [];
}

/** Catat token yang diminta user tapi belum di-cache; worker mengambilnya di siklus berikut. */
export async function requestToken(chain: string, address: string): Promise<void> {
  await (await client()).set(`want:${chain}:${address}`, "1", "EX", WANT_TTL_SEC, "NX");
}

// ---------- tulis (worker) ----------
export async function putTokens(tokens: Token[]): Promise<void> {
  if (!tokens.length) return;
  const p = (await client()).pipeline();
  for (const t of tokens) p.set(`tok:${t.chain}:${t.address}`, JSON.stringify(t), "EX", TOKEN_TTL_SEC);
  await p.exec();
}

export async function putList(scope: string, tab: ListTab, keys: string[]): Promise<void> {
  await (await client()).set(`list:${scope}:${tab}`, JSON.stringify(keys));
}

export async function getKnown(chain: string): Promise<Record<string, number>> {
  return parse<Record<string, number>>(await (await client()).get(`known:${chain}`)) ?? {};
}

export async function putKnown(chain: string, known: Record<string, number>): Promise<void> {
  await (await client()).set(`known:${chain}`, JSON.stringify(known));
}

/** Ambil dan hapus permintaan token (maks `limit`). */
export async function takeWants(limit: number): Promise<{ chain: string; address: string }[]> {
  const r = await client();
  const keys = (await r.keys("want:*")).slice(0, limit);
  if (keys.length) await r.del(...keys);
  return keys.map((k) => {
    const [, chain, ...rest] = k.split(":");
    return { chain, address: rest.join(":") };
  });
}

export async function putStatus(status: object): Promise<void> {
  await (await client()).set("bridge:status", JSON.stringify(status));
}

export async function getStatus<T = Record<string, unknown>>(): Promise<T | null> {
  return parse<T>(await (await client()).get("bridge:status"));
}

// ---------- chart & trades (langkah 2) ----------

/** Data deret per token. `pool` = pool asal data (Mode A: satu pool, yang terlikuid). */
export interface Series<T> {
  items: T[];
  updatedAt: string;
  pool: string;
}
/** holders = tab Holders/Security (langkah 7); datanya di Postgres, umurnya dicek worker lewat scanStore. */
export type ViewKind = `ohlcv-${string}` | "trades" | "holders" | "wallet";

const seriesKey = (kind: ViewKind, chain: string, address: string) =>
  kind === "wallet"
    ? `wallet:${address}`
    : kind === "trades" ? `trades:${chain}:${address}` : `ohlcv:${chain}:${address}:${kind.slice("ohlcv-".length)}`;

export async function getCandles(chain: string, address: string, interval: string): Promise<Series<Candle> | null> {
  return parse<Series<Candle>>(await (await client()).get(seriesKey(`ohlcv-${interval}`, chain, address)));
}

export async function getTradeSeries(chain: string, address: string): Promise<Series<Trade> | null> {
  return parse<Series<Trade>>(await (await client()).get(seriesKey("trades", chain, address)));
}

/** Tandai data yang sedang dilihat user (api). Dipanggil tiap request, jadi TTL ikut diperpanjang. */
export async function touchView(kind: ViewKind, chain: string, address: string): Promise<void> {
  await (await client()).set(`view:${kind}:${chain}:${address}`, String(Date.now()), "EX", VIEW_TTL_SEC);
}

export interface View {
  kind: ViewKind;
  chain: string;
  address: string;
  /** Waktu data terakhir ditulis (ms), 0 jika belum ada. */
  updatedAt: number;
}

/** Semua view aktif + umur datanya (worker). KEYS cukup untuk skala dev; produksi pakai sorted set. */
export async function activeViews(): Promise<View[]> {
  const r = await client();
  const keys = await r.keys("view:*");
  if (!keys.length) return [];
  const views = keys.map((k) => {
    const [, kind, chain, ...rest] = k.split(":");
    return { kind: kind as ViewKind, chain, address: rest.join(":"), updatedAt: 0 };
  });
  const raw = await r.mget(views.map((v) => (v.kind === "holders" ? `none:${v.chain}` : seriesKey(v.kind, v.chain, v.address))));
  raw.forEach((s, i) => {
    const at = parse<{ updatedAt?: string }>(s)?.updatedAt;
    views[i].updatedAt = at ? Date.parse(at) || 0 : 0;
  });
  return views;
}

export async function putSeries<T>(kind: ViewKind, chain: string, address: string, series: Series<T>): Promise<void> {
  await (await client()).set(seriesKey(kind, chain, address), JSON.stringify(series), "EX", TOKEN_TTL_SEC);
}

// ---------- realtime (langkah 3) ----------
// Worker mem-publish ke channel Redis bernama sama dengan channel WebSocket (docs/api/websocket.md):
//   price:{chain}:{addr}            PriceUpdate
//   trades:{chain}:{addr}           Trade[] (baru saja, terbaru dulu)
//   candles:{chain}:{addr}:{iv}     Candle (bar yang berubah)
// Gateway (apps/api) subscribe hanya ke channel yang sedang diikuti klien.

/** Field token yang berubah cepat; dikirim di channel price. */
export type PriceUpdate = Pick<
  Token,
  "price" | "priceNative" | "marketCap" | "fdv" | "liquidity" | "change" | "volume24h" | "txns24h" | "buys24h" | "sells24h" | "traders24h" | "updatedAt"
>;

export function priceUpdate(t: Token): PriceUpdate {
  const { price, priceNative, marketCap, fdv, liquidity, change, volume24h, txns24h, buys24h, sells24h, traders24h, updatedAt } = t;
  return { price, priceNative, marketCap, fdv, liquidity, change, volume24h, txns24h, buys24h, sells24h, traders24h, updatedAt };
}

export async function publishMany(messages: [channel: string, data: unknown][]): Promise<void> {
  if (!messages.length) return;
  const p = (await client()).pipeline();
  for (const [ch, data] of messages) p.publish(ch, JSON.stringify(data));
  await p.exec();
}

// ---------- wallet analytics (langkah 8) ----------
export interface TradersDoc {
  items: TraderRow[];
  updatedAt: string;
  /** Jumlah token yang deret trade-nya ikut dihitung. */
  tokens: number;
}

export async function putTraders(scope: string, doc: TradersDoc): Promise<void> {
  await (await client()).set("traders:" + scope, JSON.stringify(doc), "EX", TOKEN_TTL_SEC);
}

export async function getTraders(scope: string): Promise<TradersDoc | null> {
  return parse<TradersDoc>(await (await client()).get("traders:" + scope));
}

export async function putWallet(p: WalletProfile): Promise<void> {
  await (await client()).set("wallet:" + p.address, JSON.stringify(p), "EX", TOKEN_TTL_SEC);
}

export async function getWallet(address: string): Promise<WalletProfile | null> {
  return parse<WalletProfile>(await (await client()).get("wallet:" + address));
}

/** Semua deret trades yang ada (worker). key: chain:addr. */
export async function allTradeSeries(): Promise<Map<string, Series<Trade>>> {
  const r = await client();
  const keys = await r.keys("trades:*");
  const out = new Map<string, Series<Trade>>();
  if (!keys.length) return out;
  const raw = await r.mget(keys);
  keys.forEach((k, i) => {
    const s = parse<Series<Trade>>(raw[i]);
    if (s) out.set(k.slice("trades:".length), s);
  });
  return out;
}

// ---------- trenches (langkah 9) ----------
//   trench:state:{chain}  JSON TrenchEntry[] (state machine, hanya worker)
//   trenches:{chain}      JSON TrenchesDoc (yang dibaca api)
export interface TrenchesDoc {
  items: TrenchToken[];
  updatedAt: string;
  counts: Record<string, number>;
}

export async function getTrenchState<T>(chain: string): Promise<T[]> {
  return parse<T[]>(await (await client()).get("trench:state:" + chain)) ?? [];
}

export async function putTrenchState<T>(chain: string, entries: T[]): Promise<void> {
  await (await client()).set("trench:state:" + chain, JSON.stringify(entries), "EX", TOKEN_TTL_SEC);
}

export async function putTrenches(chain: string, doc: TrenchesDoc): Promise<void> {
  await (await client()).set("trenches:" + chain, JSON.stringify(doc), "EX", TOKEN_TTL_SEC);
}

export async function getTrenches(chain: string): Promise<TrenchesDoc | null> {
  return parse<TrenchesDoc>(await (await client()).get("trenches:" + chain));
}

// ---------- perps (langkah 10) ----------
//   perps                 JSON PerpsDoc (yang dibaca api)
//   perps:positions       JSON {address: HlPositions} sampel posisi (worker, bertahan saat restart)
export async function putPerps(doc: PerpsDoc): Promise<void> {
  await (await client()).set("perps", JSON.stringify(doc), "EX", TOKEN_TTL_SEC);
}

export async function getPerps(): Promise<PerpsDoc | null> {
  return parse<PerpsDoc>(await (await client()).get("perps"));
}

export async function putJson(key: string, value: unknown, ttlSec = TOKEN_TTL_SEC): Promise<void> {
  await (await client()).set(key, JSON.stringify(value), "EX", ttlSec);
}

export async function getJson<T>(key: string): Promise<T | null> {
  return parse<T>(await (await client()).get(key));
}
