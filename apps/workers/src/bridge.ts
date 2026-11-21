/**
 * Provider bridge (Mode A, ARCHITECTURE §3).
 *
 * - discovery (tiap 150 dtk): GeckoTerminal trending/top/new pools per chain → daftar token yang dipantau.
 * - metrics  (tiap 30 dtk):  DexScreener per 30 token → snapshot Token di Redis + daftar Discover.
 * - metadata token baru di-upsert ke Postgres `tokens`.
 * - charts   (tiap 10 dtk):  OHLCV & trades GeckoTerminal HANYA untuk token yang sedang dibuka user
 *                            (key view:* dari api), maks beberapa panggilan per siklus karena limit gratis.
 *
 * Perubahan di-publish ke Redis pub/sub (price/trades/candles) untuk gateway WebSocket (langkah 3).
 *
 * Provider TIDAK pernah dipanggil dari request user; api hanya membaca Redis.
 */
import { postgres } from "@ot/db";
import { docId, searchIndexer } from "@ot/search";
import type { Token } from "@ot/types";
import {
  BRIDGE_CHAINS,
  buildToken,
  changedBars,
  dexscreener,
  geckoterminal,
  isBridgeChain,
  isValidAddress,
  isValidPool,
  newTrades,
  normAddress,
  priceFingerprint,
  ProviderError,
  store,
  tokenKey,
  type BridgeChain,
  type GtInterval,
  type GtList,
  type GtPool,
  type View,
} from "@ot/bridge";

const CHAINS = Object.keys(BRIDGE_CHAINS) as BridgeChain[];
const MAX_KNOWN_PER_CHAIN = 250;
const KNOWN_TTL_MS = 6 * 3600_000;
const MIN_LIQ_TOP_MC = 10_000;
const MAX_WANTS_PER_CYCLE = 60;
/** Panggilan GeckoTerminal per siklus charts. Limiter bersama ±9/menit; discovery memakai ±3.6/menit. */
const MAX_CHART_CALLS_PER_CYCLE = 2;
const TRADES_REFRESH_MS = 30_000;
/** Refresh candle: minimal 60 dtk, interval besar lebih jarang (bar-nya jarang berubah). */
const ohlcvRefreshMs = (iv: GtInterval) => Math.max(60_000, Math.min(geckoterminal.GT_INTERVALS[iv].sec * 1000, 300_000));

type Log = (msg: string, extra?: object) => void;

interface ChainState {
  gt: Map<string, GtPool>; // info GeckoTerminal terbaru per token
  known: Record<string, number> | null; // addr → terakhir terlihat (ms); null = belum dimuat dari Redis
  trending: string[];
  fresh: string[];
}

export class Bridge {
  private state = new Map<BridgeChain, ChainState>(CHAINS.map((c) => [c, { gt: new Map(), known: null, trending: [], fresh: [] }]));
  private upserted = new Set<string>();
  private readonly indexer = searchIndexer();
  /** Sidik jari harga terakhir yang di-publish per token (chain:addr). */
  private lastPrice = new Map<string, string>();
  private errors: { at: string; where: string; message: string }[] = [];
  private status: Record<string, unknown> = {};

  constructor(private readonly log: Log) {}

  /** `known` disimpan di memori (worker = satu-satunya penulis) dan di-persist ke Redis untuk restart. */
  private async known(chain: BridgeChain): Promise<Record<string, number>> {
    const st = this.state.get(chain)!;
    st.known ??= await store.getKnown(chain);
    return st.known;
  }

  private fail(where: string, e: unknown) {
    const message = (e as Error).message ?? String(e);
    this.errors = [{ at: new Date().toISOString(), where, message }, ...this.errors].slice(0, 10);
    this.log(`error ${where}: ${message}`);
  }

  /** GeckoTerminal: 3 panggilan per chain. */
  async discovery() {
    const now = Date.now();
    for (const chain of CHAINS) {
      const st = this.state.get(chain)!;
      const lists: Partial<Record<GtList, GtPool[]>> = {};
      for (const list of ["trending", "top", "new"] as const) {
        try {
          lists[list] = await geckoterminal.listPools(chain, list);
        } catch (e) {
          this.fail(`geckoterminal ${chain}/${list}`, e);
        }
      }
      const all = [...(lists.trending ?? []), ...(lists.top ?? []), ...(lists.new ?? [])];
      if (!all.length) continue;
      // Pool pertama yang muncul untuk token = paling relevan (trending lebih dulu)
      for (const p of [...all].reverse()) st.gt.set(p.token.address, p);
      if (lists.trending) st.trending = uniq(lists.trending.map((p) => p.token.address));
      if (lists.new) st.fresh = uniq(lists.new.map((p) => p.token.address));

      const known = await this.known(chain);
      for (const p of all) known[p.token.address] = now;
      await store.putKnown(chain, known);
      this.log(`discovery ${chain}: ${all.length} pool, ${Object.keys(known).length} token dipantau`);
    }
    this.status.lastDiscoveryAt = new Date().toISOString();
    await this.saveStatus();
  }

  /** DexScreener: refresh semua token yang dipantau, lalu susun daftar Discover. */
  async metrics() {
    const now = Date.now();
    await this.absorbWants(now);
    const built = new Map<BridgeChain, Token[]>();

    for (const chain of CHAINS) {
      const st = this.state.get(chain)!;
      const known = await this.known(chain);
      // Buang token lama, batasi jumlah (yang terakhir terlihat didahulukan)
      const addrs = Object.entries(known)
        .filter(([, seen]) => now - seen < KNOWN_TTL_MS)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_KNOWN_PER_CHAIN)
        .map(([a]) => a);
      st.known = Object.fromEntries(addrs.map((a) => [a, known[a]]));
      await store.putKnown(chain, st.known);
      for (const a of st.gt.keys()) if (!addrs.includes(a)) st.gt.delete(a);

      const tokens: Token[] = [];
      for (let i = 0; i < addrs.length; i += dexscreener.DS_BATCH) {
        const batch = addrs.slice(i, i + dexscreener.DS_BATCH);
        let pairs = new Map<string, dexscreener.DsPair[]>();
        try {
          pairs = await dexscreener.pairsForTokens(chain, batch);
        } catch (e) {
          this.fail(`dexscreener ${chain}`, e);
        }
        for (const a of batch) {
          const t = buildToken(chain, a, pairs.get(a) ?? [], st.gt.get(a), now);
          if (t) tokens.push(t);
        }
      }
      await store.putTokens(tokens);
      await this.publishPrices(tokens);
      built.set(chain, tokens);
      await this.writeLists(chain, tokens, st);
      await this.upsertMetadata(chain, tokens, st);
      this.log(`metrics ${chain}: ${tokens.length}/${addrs.length} token diperbarui`);
    }

    await this.writeAllLists(built);
    // Lupakan sidik jari token yang tidak lagi dipantau (peta tidak tumbuh tanpa batas)
    const live = new Set([...built.values()].flat().map((t) => tokenKey(t.chain, t.address)));
    for (const k of this.lastPrice.keys()) if (!live.has(k)) this.lastPrice.delete(k);
    this.status.lastMetricsAt = new Date().toISOString();
    this.status.tokens = Object.fromEntries([...built].map(([c, t]) => [c, t.length]));
    await this.saveStatus();
  }

  /** OHLCV & trades untuk view aktif yang datanya sudah waktunya di-refresh. */
  async charts() {
    const now = Date.now();
    const views = await store.activeViews();
    const due = views
      .filter((v) => v.kind !== "holders" && v.kind !== "wallet" && isBridgeChain(v.chain) && isValidAddress(v.chain, v.address))
      .filter((v) => now - v.updatedAt > refreshMs(v))
      .sort((a, b) => a.updatedAt - b.updatedAt); // belum pernah diambil (0) didahulukan
    let calls = 0;
    for (const v of due) {
      if (calls >= MAX_CHART_CALLS_PER_CYCLE) break;
      const chain = v.chain as BridgeChain;
      const token = await store.getToken(chain, v.address);
      if (!token) {
        await store.requestToken(chain, v.address); // token belum dipantau: masuk antrean metrics dulu
        continue;
      }
      const pool = token.mainPool;
      if (!pool || !isValidPool(chain, pool)) continue;
      calls++;
      try {
        const updatedAt = new Date().toISOString();
        if (v.kind === "trades") {
          const prev = await store.getTradeSeries(chain, v.address);
          const items = await geckoterminal.poolTrades(chain, pool, v.address);
          await store.putSeries(v.kind, chain, v.address, { items, updatedAt, pool });
          const fresh = newTrades(prev?.pool === pool ? prev.items : null, items);
          if (fresh.length) await store.publishMany([[`trades:${chain}:${v.address}`, fresh]]);
        } else {
          const iv = v.kind.slice("ohlcv-".length) as GtInterval;
          const prev = await store.getCandles(chain, v.address, iv);
          const items = await geckoterminal.poolOhlcv(chain, pool, v.address, iv);
          await store.putSeries(v.kind, chain, v.address, { items, updatedAt, pool });
          const ch = `candles:${chain}:${v.address}:${iv}`;
          await store.publishMany(changedBars(prev?.pool === pool ? prev.items : null, items).map((c) => [ch, c]));
        }
      } catch (e) {
        this.fail(`geckoterminal ${v.kind} ${chain}:${v.address}`, e);
        // Pool tidak dikenal GeckoTerminal: simpan kosong supaya tidak diminta ulang tiap siklus
        if (e instanceof ProviderError && e.status === 404)
          await store.putSeries(v.kind, chain, v.address, { items: [], updatedAt: new Date().toISOString(), pool });
      }
    }
    this.status.charts = { active: views.length, due: due.length, fetched: calls, at: new Date().toISOString() };
    if (calls) await this.saveStatus();
  }

  /** Publish channel price untuk token yang angkanya berubah sejak siklus sebelumnya. */
  private async publishPrices(tokens: Token[]) {
    const msgs: [string, unknown][] = [];
    for (const t of tokens) {
      const key = tokenKey(t.chain, t.address);
      const u = store.priceUpdate(t);
      const fp = priceFingerprint(u);
      if (this.lastPrice.get(key) === fp) continue;
      this.lastPrice.set(key, fp);
      msgs.push([`price:${key}`, u]);
    }
    try {
      await store.publishMany(msgs);
    } catch (e) {
      this.fail("publish price", e);
    }
  }

  private async absorbWants(now: number) {
    const wants = await store.takeWants(MAX_WANTS_PER_CYCLE);
    for (const w of wants) {
      if (!isBridgeChain(w.chain) || !isValidAddress(w.chain, w.address)) continue;
      (await this.known(w.chain))[normAddress(w.chain, w.address)] = now;
    }
    if (wants.length) this.log(`want: ${wants.length} token diminta user`);
  }

  private async writeLists(chain: BridgeChain, tokens: Token[], st: ChainState) {
    const have = new Set(tokens.map((t) => t.address));
    await store.putList(chain, "trending", st.trending.filter((a) => have.has(a)).map((a) => tokenKey(chain, a)));
    await store.putList(chain, "new", st.fresh.filter((a) => have.has(a)).map((a) => tokenKey(chain, a)));
    await store.putList(chain, "top-mc", topMc(tokens).map((t) => tokenKey(t.chain, t.address)));
  }

  private async writeAllLists(built: Map<BridgeChain, Token[]>) {
    const perChainTrending = await Promise.all(CHAINS.map((c) => store.getList(c, "trending")));
    await store.putList("all", "trending", interleave(perChainTrending));
    const all = [...built.values()].flat();
    await store.putList("all", "top-mc", topMc(all).map((t) => tokenKey(t.chain, t.address)));
    const fresh = new Set((await Promise.all(CHAINS.map((c) => store.getList(c, "new")))).flat());
    await store.putList(
      "all",
      "new",
      all
        .filter((t) => fresh.has(tokenKey(t.chain, t.address)))
        .sort((a, b) => a.ageMinutes - b.ageMinutes)
        .map((t) => tokenKey(t.chain, t.address)),
    );
  }

  /**
   * Metadata token ke Postgres (sekali per proses per token) — juga sumber search fallback pg_trgm.
   * decimals boleh NULL (belum diketahui); nilai lama tidak ditimpa NULL.
   * Bila Meilisearch dikonfigurasi, dokumen search (dengan likuiditas/volume terbaru) dikirim tiap siklus.
   */
  private async upsertMetadata(chain: BridgeChain, tokens: Token[], st: ChainState) {
    await this.indexSearch(tokens);
    const pool = postgres();
    if (!pool) return;
    const rows = tokens
      .filter((t) => !this.upserted.has(tokenKey(chain, t.address)))
      .map((t) => {
        const gt = st.gt.get(t.address);
        return [chain, t.address, t.symbol, t.name, gt?.token.decimals ?? null, t.logoUrl ?? null, JSON.stringify(t.socials), gt?.createdAt ? new Date(gt.createdAt) : null, t.source ?? "provider"];
      });
    if (!rows.length) return;
    const values = rows.map((_, i) => `(${Array.from({ length: 9 }, (_, j) => `$${i * 9 + j + 1}`).join(",")})`).join(",");
    try {
      await pool.query(
        `INSERT INTO tokens (chain_id, address, symbol, name, decimals, logo_url, socials, created_at_chain, data_source)
         VALUES ${values}
         ON CONFLICT (chain_id, address) DO UPDATE SET
           symbol = EXCLUDED.symbol, name = EXCLUDED.name, logo_url = EXCLUDED.logo_url,
           decimals = COALESCE(EXCLUDED.decimals, tokens.decimals),
           created_at_chain = COALESCE(EXCLUDED.created_at_chain, tokens.created_at_chain),
           socials = EXCLUDED.socials, data_source = EXCLUDED.data_source, updated_at = now()`,
        rows.flat(),
      );
      for (const r of rows) this.upserted.add(tokenKey(chain, r[1] as string));
    } catch (e) {
      this.fail(`postgres upsert ${chain}`, e);
    }
  }

  private async indexSearch(tokens: Token[]) {
    if (!this.indexer || !tokens.length) return;
    try {
      await this.indexer.upsert(
        tokens.map((t) => ({
          id: docId(t.chain, t.address),
          chain: t.chain,
          address: t.address,
          symbol: t.symbol,
          name: t.name,
          liquidity: t.liquidity,
          volume24h: t.volume24h,
          hidden: false,
        })),
      );
    } catch (e) {
      this.fail("meilisearch index", e);
    }
  }

  private async saveStatus() {
    await store.putStatus({ ...this.status, errors: this.errors });
  }
}

function refreshMs(v: View): number {
  if (v.kind === "trades") return TRADES_REFRESH_MS;
  const iv = v.kind.slice("ohlcv-".length);
  return geckoterminal.isGtInterval(iv) ? ohlcvRefreshMs(iv) : Infinity;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function topMc(tokens: Token[]): Token[] {
  return tokens
    .filter((t) => t.liquidity >= MIN_LIQ_TOP_MC && t.marketCap > 0)
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, 100);
}

/** Gabung daftar per chain bergiliran: a1, b1, c1, a2, b2, ... */
export function interleave(lists: string[][]): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}
