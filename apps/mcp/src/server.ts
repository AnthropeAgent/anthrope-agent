import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, type ApiConfig } from "./client.ts";

export const SERVER_NAME = "anthrope-agent";
export const SERVER_VERSION = "0.1.0";

const MAX_CHARS = 40_000;
const chain = z.string().min(2).max(24).describe("Chain id, mis. solana, ethereum, base, bsc");
const address = z.string().min(20).max(80).describe("Alamat kontrak token (base58 untuk Solana, 0x… untuk EVM)");
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

/** Hasil tool: JSON ringkas sebagai teks, dipotong bila terlalu panjang, plus catatan bila data masih disiapkan worker. */
export function toResult(data: unknown) {
  let text = JSON.stringify(data, null, 1);
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + "\n…(dipotong; persempit query atau pakai limit lebih kecil)";
  const pending = typeof data === "object" && data !== null && (data as { pending?: unknown }).pending === true;
  const content = [{ type: "text" as const, text }];
  if (pending) content.push({ type: "text" as const, text: "Catatan: data sedang disiapkan worker (pending). Panggil tool yang sama lagi dalam 5–15 detik." });
  return { content };
}

function fail(e: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: `Gagal mengambil data: ${(e as Error).message}` }] };
}

export function createServer(cfg: ApiConfig, fetchImpl: typeof fetch = fetch) {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Data pasar onchain dari Anthrope Agent (harga, likuiditas, holder, scan keamanan, trader, wallet, pump.fun trenches, perps Hyperliquid). " +
        "Semua tool hanya membaca. Data pihak ketiga bisa terlambat; sebutkan waktu updatedAt bila relevan. Ini bukan saran investasi.",
    },
  );
  const get = (path: string, q?: Record<string, string | number | boolean | undefined>) => apiGet(cfg, path, q, fetchImpl);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      return toResult(await fn());
    } catch (e) {
      return fail(e);
    }
  };
  // Pembungkus longgar: inferensi generik registerTool/registerPrompt dengan zod membuat tsc kehabisan memori.
  // Validasi input tetap dilakukan SDK saat runtime memakai skema zod yang sama.
  type Shape = Record<string, z.ZodTypeAny>;
  type ToolResult = ReturnType<typeof toResult> | ReturnType<typeof fail>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Args = any;
  const tool = (name: string, config: { title: string; description: string; inputSchema: Shape; annotations: typeof READ_ONLY }, cb: (a: Args) => Promise<ToolResult>) =>
    (server.registerTool as unknown as (n: string, c: unknown, f: unknown) => void)(name, config, cb);
  const prompt = (name: string, config: { title: string; description: string; argsSchema: Shape }, cb: (a: Args) => unknown) =>
    (server.registerPrompt as unknown as (n: string, c: unknown, f: unknown) => void)(name, config, cb);
  const tokenPath = (c: string, a: string, sub = "") => `/tokens/${encodeURIComponent(c)}/${encodeURIComponent(a)}${sub}`;

  tool(
    "search_tokens",
    {
      title: "Cari token",
      description: "Cari token berdasarkan simbol, nama, atau alamat kontrak. Mulai dari sini bila pengguna menyebut token dengan nama.",
      inputSchema: { query: z.string().min(1).max(100), chain: z.string().optional().describe("Batasi ke satu chain, atau kosongkan untuk semua"), limit: z.number().int().min(1).max(20).optional() },
      annotations: READ_ONLY,
    },
    ({ query, chain: c, limit }) => run(() => get("/search", { q: query, chain: c, limit })),
  );

  tool(
    "list_tokens",
    {
      title: "Daftar token (Discover)",
      description: "Token trending, baru, top market cap, atau RWA, dengan filter likuiditas/market cap/volume.",
      inputSchema: {
        tab: z.enum(["trending", "new", "top-mc", "rwas"]).default("trending"),
        chain: z.string().optional(),
        timeframe: z.enum(["5m", "1h", "6h", "24h"]).optional(),
        minLiquidity: z.number().nonnegative().optional(),
        minMarketCap: z.number().nonnegative().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: READ_ONLY,
    },
    (a) => run(() => get("/tokens", { ...a, limit: a.limit ?? 25 })),
  );

  tool(
    "get_token",
    { title: "Detail token", description: "Harga, market cap, FDV, likuiditas, volume, perubahan harga, jumlah transaksi, launchpad.", inputSchema: { chain, address }, annotations: READ_ONLY },
    ({ chain: c, address: a }) => run(() => get(tokenPath(c, a))),
  );

  tool(
    "get_token_security",
    {
      title: "Scan keamanan token",
      description: "Hasil scan kontrak (mint/freeze authority, honeypot, pajak jual/beli, LP terkunci, dsb). Pakai sebelum menilai risiko token.",
      inputSchema: { chain, address },
      annotations: READ_ONLY,
    },
    ({ chain: c, address: a }) => run(() => get(tokenPath(c, a, "/security"))),
  );

  tool(
    "get_token_holders",
    { title: "Holder token", description: "Top 100 holder dan konsentrasi kepemilikan (top 10 %, dsb).", inputSchema: { chain, address }, annotations: READ_ONLY },
    ({ chain: c, address: a }) => run(() => get(tokenPath(c, a, "/holders"))),
  );

  tool(
    "get_token_trades",
    { title: "Transaksi terbaru token", description: "Swap terbaru (beli/jual, ukuran USD, wallet).", inputSchema: { chain, address, limit: z.number().int().min(1).max(100).optional() }, annotations: READ_ONLY },
    ({ chain: c, address: a, limit }) => run(() => get(tokenPath(c, a, "/trades"), { limit: limit ?? 50 })),
  );

  tool(
    "get_token_markets",
    { title: "Pasar/pool token", description: "Pool DEX tempat token diperdagangkan, likuiditas dan volume per pool.", inputSchema: { chain, address }, annotations: READ_ONLY },
    ({ chain: c, address: a }) => run(() => get(tokenPath(c, a, "/markets"))),
  );

  tool(
    "get_wallet",
    {
      title: "Profil wallet",
      description: "Net worth, holdings, PnL terpantau, dan aktivitas wallet Solana atau EVM.",
      inputSchema: { address: z.string().min(20).max(80).describe("Alamat wallet Solana (base58) atau EVM (0x…)") },
      annotations: READ_ONLY,
    },
    ({ address: a }) => run(() => get(`/wallets/${encodeURIComponent(a)}`)),
  );

  tool(
    "top_traders",
    {
      title: "Top traders",
      description: "Trader dengan PnL tertinggi, global atau untuk satu token. PnL dihitung dari transaksi yang dipantau platform, bukan riwayat penuh wallet.",
      inputSchema: { token: z.string().optional().describe("Opsional, format chain:address"), limit: z.number().int().min(1).max(100).optional() },
      annotations: READ_ONLY,
    },
    ({ token, limit }) => run(() => get("/traders", { token, scope: token ? undefined : "all", limit: limit ?? 25 })),
  );

  tool(
    "pump_trenches",
    { title: "Trenches pump.fun", description: "Token pump.fun per tahap: new, final stretch, migrated, dengan progress bonding curve.", inputSchema: { chain: z.enum(["solana"]).default("solana") }, annotations: READ_ONLY },
    ({ chain: c }) => run(() => get(`/trenches/${c}`)),
  );

  tool(
    "perps_overview",
    { title: "Perps Hyperliquid", description: "Pasar perps (harga mark, funding, open interest) dan distribusi posisi long/short per segmen wallet.", inputSchema: {}, annotations: READ_ONLY },
    () => run(() => get("/perps")),
  );

  tool(
    "research_articles",
    {
      title: "Artikel riset",
      description: "Daftar artikel riset dan blog yang terbit. Isi `slug` untuk membaca satu artikel lengkap.",
      inputSchema: { category: z.enum(["blog", "flagship-reports", "insight-articles"]).optional(), slug: z.string().max(120).optional() },
      annotations: READ_ONLY,
    },
    ({ category, slug }) => run(() => (slug ? get(`/articles/${encodeURIComponent(slug)}`) : get("/articles", { category }))),
  );

  tool(
    "data_sources_status",
    { title: "Status sumber data", description: "Mode data per chain (bridge pihak ketiga atau indexer sendiri) dan kesegarannya.", inputSchema: {}, annotations: READ_ONLY },
    () => run(() => get("/status/data-sources")),
  );

  prompt(
    "token_due_diligence",
    { title: "Due diligence token", description: "Analisis lengkap satu token: pasar, keamanan, holder, dan aliran trader.", argsSchema: { chain: z.string(), address: z.string() } },
    ({ chain: c, address: a }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Lakukan due diligence untuk token ${c}:${a}. Panggil get_token, get_token_security, get_token_holders, get_token_markets, dan top_traders (token=${c}:${a}). ` +
              "Ringkas: (1) kondisi pasar & likuiditas vs market cap, (2) tanda bahaya keamanan, (3) konsentrasi holder, (4) apa yang dilakukan trader teratas. " +
              "Tutup dengan daftar risiko utama. Sebutkan waktu data. Jangan beri saran beli/jual.",
          },
        },
      ],
    }),
  );

  prompt(
    "market_brief",
    { title: "Ringkasan pasar", description: "Gambaran pasar onchain saat ini dari token trending, trenches, dan perps.", argsSchema: { chain: z.string().optional() } },
    ({ chain: c }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Buat ringkasan pasar onchain${c ? ` untuk chain ${c}` : ""}. Panggil list_tokens (trending), pump_trenches, dan perps_overview. ` +
              "Soroti 3–5 hal penting, token dengan likuiditas sehat vs yang berisiko, dan sentimen long/short di perps. Bukan saran investasi.",
          },
        },
      ],
    }),
  );

  return server;
}
