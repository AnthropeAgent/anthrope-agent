/**
 * DATA ADAPTER
 * Semua halaman mengambil data lewat interface ini, bukan langsung dari mock.
 *
 * NEXT_PUBLIC_MARKET_DATA=api (default): method yang sudah punya endpoint memakai /api/v1,
 * sisanya masih mock sampai langkahnya selesai (lihat docs/ARCHITECTURE.md §11).
 * NEXT_PUBLIC_MARKET_DATA=mock: semua data contoh (tanpa api/worker).
 */
import type { ChainId } from "@/config/chains";
import { apiGetArticle, apiGetCandles, apiGetHolders, apiListArticles, apiGetPerps, apiGetToken, apiGetTopTraders, apiGetTrades, apiGetTrenches, apiListTokens, apiSearch, type CandleSeries, type SearchResult } from "./api";
import * as mock from "./mock";
export type { CandleSeries } from "./api";
import type {
  Article,
  Holder,
  ListTokensParams,
  PerpsDoc,
  Token,
  TraderRow,
  Trade,
  TrenchToken,
} from "./types";

export interface MarketDataProvider {
  listTokens(p: ListTokensParams): Promise<Token[]>;
  getToken(chain: string, address: string): Promise<Token | null>;
  getCandles(token: Token, intervalSec: number): Promise<CandleSeries>;
  getTrades(token: Token): Promise<Trade[]>;
  getHolders(token: Token): Promise<Holder[]>;
  getTopTraders(scope?: string): Promise<TraderRow[]>;
  getTrenches(chain: ChainId): Promise<TrenchToken[]>;
  getPerps(): Promise<PerpsDoc | null>;
  listArticles(category?: Article["category"]): Promise<Article[]>;
  getArticle(slug: string): Promise<Article | null>;
  search(q: string): Promise<SearchResult>;
}

export const mockProvider: MarketDataProvider = {
  async listTokens({ tab, chain = "all", timeframe = "24h", limit = 50 }) {
    let list = mock.allTokens().filter((t) => (chain === "all" ? true : t.chain === chain));
    if (tab === "rwas") list = list.filter((t) => t.isRwa);
    else list = list.filter((t) => !t.isRwa || tab === "top-mc");
    if (tab === "top-mc") list = [...list].sort((a, b) => b.marketCap - a.marketCap);
    if (tab === "trending")
      list = [...list].sort(
        (a, b) =>
          b.volume24h * (1 + Math.abs(b.change[timeframe] ?? 0) / 50) -
          a.volume24h * (1 + Math.abs(a.change[timeframe] ?? 0) / 50),
      );
    if (tab === "rwas") list = [...list].sort((a, b) => b.marketCap - a.marketCap);
    return list.slice(0, limit);
  },
  async getToken(chain, address) {
    return mock.allTokens().find((t) => t.chain === chain && t.address === address) ?? null;
  },
  async getCandles(token, intervalSec) {
    return { items: mock.candlesFor(token, intervalSec), pending: false, unsupported: false, updatedAt: null };
  },
  async getTrades(token) {
    return mock.tradesFor(token);
  },
  async getHolders(token) {
    return mock.holdersFor(token);
  },
  async getTopTraders(scope = "global") {
    return mock.topTraders(scope);
  },
  async getTrenches(chain) {
    return mock.trenchTokens(chain);
  },
  async getPerps() {
    return mock.perpsDoc();
  },
  async listArticles(category) {
    const a = mock.articles();
    return category ? a.filter((x) => x.category === category) : a;
  },
  async getArticle(slug) {
    return mock.articles().find((a) => a.slug === slug) ?? null;
  },
  async search(q) {
    const s = q.trim().toLowerCase();
    if (!s) return { tokens: [], pending: [] };
    const tokens = mock
      .allTokens()
      .filter((t) => t.symbol.toLowerCase().includes(s) || t.name.toLowerCase().includes(s) || t.address.toLowerCase().startsWith(s))
      .slice(0, 8);
    return { tokens, pending: [] };
  },
};

const SAMPLE_ARTICLES = process.env.NEXT_PUBLIC_SAMPLE_ARTICLES ? process.env.NEXT_PUBLIC_SAMPLE_ARTICLES === "1" : process.env.NODE_ENV !== "production";

/** Langkah 1: listTokens, getToken. Langkah 2: candles, trades. Langkah 4: search. Langkah 7: holders. Langkah 8: top traders. Langkah 9: trenches (Solana). Langkah 10: perps. Sisanya mock. */
export const apiProvider: MarketDataProvider = {
  ...mockProvider,
  listTokens: apiListTokens,
  getToken: apiGetToken,
  getCandles: apiGetCandles,
  getTrades: apiGetTrades,
  getHolders: (t) => (t.source && t.source !== "mock" ? apiGetHolders(t) : mockProvider.getHolders(t)),
  getTopTraders: apiGetTopTraders,
  getTrenches: async (chain) => (await apiGetTrenches(chain)).items,
  getPerps: apiGetPerps,
  // CMS (langkah 12): artikel dari DB. Artikel contoh hanya dipakai di development (atau NEXT_PUBLIC_SAMPLE_ARTICLES=1)
  // selama CMS kosong; di production situs tidak pernah menampilkan artikel contoh sebagai berita asli.
  listArticles: async (category) => {
    const all = await apiListArticles();
    if (!all?.length) return SAMPLE_ARTICLES ? mockProvider.listArticles(category) : [];
    return category ? all.filter((a) => a.category === category) : all;
  },
  getArticle: async (slug) => (await apiGetArticle(slug)) ?? (SAMPLE_ARTICLES && !(await apiListArticles())?.length ? mockProvider.getArticle(slug) : null),
  search: apiSearch,
};

export const dataSource: "api" | "mock" = process.env.NEXT_PUBLIC_MARKET_DATA === "mock" ? "mock" : "api";

export const dataProvider: MarketDataProvider = dataSource === "mock" ? mockProvider : apiProvider;
