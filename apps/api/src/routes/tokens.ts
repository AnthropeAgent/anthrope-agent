/**
 * GET /api/v1/tokens                     daftar Discover (top-mc, trending, new, rwas)
 * GET /api/v1/tokens/{chain}/{address}   detail token
 * GET /api/v1/tokens/{chain}/{address}/ohlcv   candle (langkah 2)
 * GET /api/v1/tokens/{chain}/{address}/trades  transaksi terbaru (langkah 2)
 * GET /api/v1/tokens/{chain}/{address}/holders top 100 holder (langkah 7)
 * GET /api/v1/tokens/{chain}/{address}/security hasil security scan (langkah 7)
 *
 * Hanya membaca store Redis yang diisi worker bridge. Token yang belum di-cache dicatat
 * sebagai permintaan (worker mengambilnya di siklus berikut) dan dibalas 404.
 * Chart & trades: tiap request menandai "view" supaya worker mengambil/me-refresh datanya;
 * selama belum ada, balasan berisi items kosong dengan `pending: true`.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { geckoterminal, scanStore, isBridgeChain, isValidAddress, normAddress, store, StoreUnavailableError, type BridgeChain, type ListTab, type Series, type ViewKind } from "@ot/bridge";
import type { ApiError, Candle, ChainId, HoldersSnapshot, SecurityReport, Token, Trade } from "@ot/types";

/** Bagian store yang dipakai route (bisa diganti di tes). */
export interface TokenStore {
  getToken(chain: string, address: string): Promise<Token | null>;
  getTokens(keys: string[]): Promise<Token[]>;
  getList(scope: string, tab: ListTab): Promise<string[]>;
  requestToken(chain: string, address: string): Promise<void>;
  getCandles(chain: string, address: string, interval: string): Promise<Series<Candle> | null>;
  getTradeSeries(chain: string, address: string): Promise<Series<Trade> | null>;
  touchView(kind: ViewKind, chain: string, address: string): Promise<void>;
}

export const redisTokenStore: TokenStore = store;

/** Hasil scan holders & security (Postgres, ditulis worker). */
export interface ScanReader {
  getReport(chain: string, address: string): Promise<SecurityReport | null>;
  getHolders(chain: string, address: string): Promise<HoldersSnapshot | null>;
}
export const pgScanReader: ScanReader = { getReport: scanStore.getReport, getHolders: scanStore.getHolders };
/** Holders lebih tua dari ini ditandai stale (worker refresh tiap 5 menit selama dilihat). */
export const HOLDERS_STALE_MS = 15 * 60_000;

/** Timpa field security/holders token dengan hasil scan (bila ada). */
export function withScan(t: Token, r: SecurityReport | null): Token {
  if (!r) return t;
  return { ...t, security: r.summary, top10Pct: r.top10Pct ?? t.top10Pct, holders: r.holderCount ?? t.holders };
}

/** Snapshot lebih tua dari ini ditandai `stale` (worker refresh tiap ±30 dtk). */
export const STALE_MS = 120_000;
/** Chart/trades lebih tua dari ini ditandai `stale` (refresh 30 dtk sampai 5 menit, tergantung interval). */
export const SERIES_STALE_MS = 10 * 60_000;

const CHAIN_IDS = ["solana", "robinhood", "bsc", "base", "ethereum", "arbitrum", "avalanche", "polygon", "sui", "optimism", "monad", "hyperevm"] as const satisfies readonly ChainId[];

const ListQuery = z.object({
  tab: z.enum(["top-mc", "trending", "rwas", "new"]).default("trending"),
  chain: z.enum(["all", ...CHAIN_IDS]).default("all"),
  timeframe: z.enum(["5m", "1h", "4h", "24h"]).default("24h"),
  minLiquidity: z.coerce.number().nonnegative().optional(),
  minMarketCap: z.coerce.number().nonnegative().optional(),
  minVolume: z.coerce.number().nonnegative().optional(),
  verifiedOnly: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(32).optional(),
});

const Params = z.object({ chain: z.string().max(20), address: z.string().max(100) });

const OhlcvQuery = z.object({
  interval: z.enum(["1s", "5s", "1m", "5m", "15m", "1h", "4h", "1d"]),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  unit: z.enum(["price", "mcap"]).default("price"),
});

const TradesQuery = z.object({
  side: z.enum(["buy", "sell"]).optional(),
  minValueUsd: z.coerce.number().nonnegative().optional(),
  maker: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(32).optional(),
});

function err(reply: FastifyReply, status: number, code: string, message: string) {
  const body: ApiError = { error: { code, message } };
  return reply.code(status).send(body);
}

export function withStale(t: Token, now = Date.now()): Token {
  const age = t.updatedAt ? now - Date.parse(t.updatedAt) : Infinity;
  return { ...t, stale: !(age < STALE_MS) };
}

const encodeCursor = (offset: number) => Buffer.from(`o:${offset}`).toString("base64url");
function decodeCursor(c: string | undefined): number | null {
  if (!c) return 0;
  const m = /^o:(\d{1,6})$/.exec(Buffer.from(c, "base64url").toString());
  return m ? Number(m[1]) : null;
}

/** Meta umum respons chart/trades. */
function seriesMeta<T>(series: Series<T> | null, now = Date.now()) {
  if (!series) return { updatedAt: null, stale: true, pending: true, pool: null };
  const age = now - Date.parse(series.updatedAt);
  return { updatedAt: series.updatedAt, stale: !(age < SERIES_STALE_MS), pending: false, pool: series.pool };
}

export async function tokenRoutes(app: FastifyInstance, opts: { store: TokenStore; scans?: ScanReader | null }) {
  const s = opts.store;
  const scans = opts.scans ?? null;
  /** Scan bersifat tambahan: Postgres mati tidak boleh menjatuhkan detail token. */
  const safeReport = (chain: string, address: string) => (scans ? scans.getReport(chain, address).catch(() => null) : Promise.resolve(null));

  app.get("/tokens", async (req, reply) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) return err(reply, 400, "INVALID_QUERY", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const q = parsed.data;
    const offset = decodeCursor(q.cursor);
    if (offset === null) return err(reply, 400, "INVALID_CURSOR", "cursor tidak valid");

    // RWAs: daftar dikurasi admin (tabel rwa_assets) belum ada di langkah 1.
    const keys = q.tab === "rwas" || (q.chain !== "all" && !isBridgeChain(q.chain)) ? [] : await s.getList(q.chain, q.tab);
    const now = Date.now();
    const filtered = (await s.getTokens(keys))
      .filter(
        (t) =>
          (q.minLiquidity == null || t.liquidity >= q.minLiquidity) &&
          (q.minMarketCap == null || t.marketCap >= q.minMarketCap) &&
          (q.minVolume == null || t.volume24h >= q.minVolume) &&
          (!q.verifiedOnly || t.verified),
      )
      .map((t) => withStale(t, now));
    const items = filtered.slice(offset, offset + q.limit);
    const next = offset + q.limit < filtered.length ? encodeCursor(offset + q.limit) : null;
    const updatedAt = items.reduce<string | undefined>((m, t) => (t.updatedAt && (!m || t.updatedAt > m) ? t.updatedAt : m), undefined);
    reply.header("cache-control", "public, max-age=5");
    return { items, nextCursor: next, updatedAt: updatedAt ?? new Date(now).toISOString() };
  });

  /** Validasi :chain/:address; mengirim error dan mengembalikan null bila tidak valid. */
  function target(params: unknown, reply: FastifyReply): { chain: BridgeChain; address: string } | null {
    const p = Params.safeParse(params);
    if (!p.success) {
      err(reply, 400, "INVALID_PARAMS", "chain/address tidak valid");
      return null;
    }
    const { chain, address } = p.data;
    if (!isBridgeChain(chain)) {
      err(reply, 404, "CHAIN_NOT_SUPPORTED", `Chain ${chain} belum didukung sumber data`);
      return null;
    }
    if (!isValidAddress(chain, address)) {
      err(reply, 400, "INVALID_ADDRESS", `Alamat tidak valid untuk ${chain}`);
      return null;
    }
    return { chain, address: normAddress(chain, address) };
  }

  app.get("/tokens/:chain/:address", async (req, reply) => {
    const tg = target(req.params, reply);
    if (!tg) return reply;
    const { chain, address } = tg;

    const t = await s.getToken(chain, address);
    if (!t) {
      await s.requestToken(chain, address);
      reply.header("retry-after", "30");
      return err(reply, 404, "TOKEN_NOT_FOUND", "Token belum ada di cache; sedang diambil, coba lagi dalam ±30 detik");
    }
    reply.header("cache-control", "public, max-age=5");
    return withStale(withScan(t, await safeReport(chain, address)));
  });

  app.get("/tokens/:chain/:address/ohlcv", async (req, reply) => {
    const tg = target(req.params, reply);
    if (!tg) return reply;
    const q = OhlcvQuery.safeParse(req.query);
    if (!q.success) return err(reply, 400, "INVALID_QUERY", q.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const { interval, from, to, unit } = q.data;
    if (!geckoterminal.isGtInterval(interval))
      return err(reply, 400, "INTERVAL_NOT_SUPPORTED", `Interval ${interval} butuh indexer sendiri (belum tersedia); pakai 1m atau lebih besar`);

    await s.touchView(`ohlcv-${interval}`, tg.chain, tg.address);
    const series = await s.getCandles(tg.chain, tg.address, interval);
    let items = (series?.items ?? []).filter((c) => (from == null || c.time >= from) && (to == null || c.time <= to));
    if (unit === "mcap") {
      const t = await s.getToken(tg.chain, tg.address);
      const k = t && t.price > 0 ? t.marketCap / t.price : null;
      if (k == null) return err(reply, 409, "MCAP_UNAVAILABLE", "Market cap token belum diketahui");
      items = items.map((c) => ({ ...c, open: c.open * k, high: c.high * k, low: c.low * k, close: c.close * k }));
    }
    if (!series) reply.header("retry-after", "10");
    reply.header("cache-control", "public, max-age=5");
    return { items, interval, ...seriesMeta(series) };
  });

  app.get("/tokens/:chain/:address/trades", async (req, reply) => {
    const tg = target(req.params, reply);
    if (!tg) return reply;
    const q = TradesQuery.safeParse(req.query);
    if (!q.success) return err(reply, 400, "INVALID_QUERY", q.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const offset = decodeCursor(q.data.cursor);
    if (offset === null) return err(reply, 400, "INVALID_CURSOR", "cursor tidak valid");
    const { side, minValueUsd, limit } = q.data;
    const maker = q.data.maker && normAddress(tg.chain, q.data.maker);

    await s.touchView("trades", tg.chain, tg.address);
    const series = await s.getTradeSeries(tg.chain, tg.address);
    const filtered = (series?.items ?? []).filter(
      (t) => (!side || t.side === side) && (minValueUsd == null || t.valueUsd >= minValueUsd) && (!maker || normAddress(tg.chain, t.maker) === maker),
    );
    const items = filtered.slice(offset, offset + limit);
    const nextCursor = offset + limit < filtered.length ? encodeCursor(offset + limit) : null;
    if (!series) reply.header("retry-after", "10");
    reply.header("cache-control", "public, max-age=5");
    return { items, nextCursor, ...seriesMeta(series) };
  });

  app.get("/tokens/:chain/:address/holders", async (req, reply) => {
    const tg = target(req.params, reply);
    if (!tg) return reply;
    if (!scans) return err(reply, 503, "SERVICE_UNAVAILABLE", "Data holders belum tersedia (Postgres tidak dikonfigurasi)");
    await s.touchView("holders", tg.chain, tg.address);
    const h = await scans.getHolders(tg.chain, tg.address).catch(() => null);
    reply.header("cache-control", "public, max-age=10");
    if (!h) {
      reply.header("retry-after", "10");
      return { items: [], holderCount: null, top10Pct: null, source: null, updatedAt: null, stale: true, pending: true };
    }
    return { ...h, stale: !(Date.now() - Date.parse(h.updatedAt) < HOLDERS_STALE_MS), pending: false };
  });

  app.get("/tokens/:chain/:address/security", async (req, reply) => {
    const tg = target(req.params, reply);
    if (!tg) return reply;
    if (!scans) return err(reply, 503, "SERVICE_UNAVAILABLE", "Security scan belum tersedia (Postgres tidak dikonfigurasi)");
    await s.touchView("holders", tg.chain, tg.address);
    const r = await scans.getReport(tg.chain, tg.address).catch(() => null);
    reply.header("cache-control", "public, max-age=10");
    if (!r) {
      reply.header("retry-after", "10");
      return { report: null, pending: true };
    }
    return { report: r, pending: false };
  });

  app.setErrorHandler((e, _req, reply) => {
    if (e instanceof StoreUnavailableError) return err(reply, 503, "SERVICE_UNAVAILABLE", "Data pasar sementara tidak tersedia");
    throw e;
  });
}
