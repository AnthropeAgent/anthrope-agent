/**
 * Data pasar agregat yang dihitung worker dan hanya dibaca api.
 *   GET /api/v1/trenches/{chain}   Trenches pump.fun (langkah 9)
 *   GET /api/v1/perps              Perps Hyperliquid: pasar + distribusi posisi wallet (langkah 10)
 */
import type { FastifyInstance } from "fastify";
import { store, StoreUnavailableError, type TrenchesDoc } from "@ot/bridge";
import type { PerpsDoc } from "@ot/types";

export interface MarketStore {
  getTrenches(chain: string): Promise<TrenchesDoc | null>;
  getPerps(): Promise<PerpsDoc | null>;
}
export const redisMarketStore: MarketStore = { getTrenches: store.getTrenches, getPerps: store.getPerps };

/** Chain yang punya worker Trenches. */
export const TRENCH_CHAINS = new Set(["solana"]);
const TRENCHES_STALE_MS = 3 * 60_000;
const PERPS_STALE_MS = 5 * 60_000;

export async function marketRoutes(app: FastifyInstance, opts: { store: MarketStore }) {
  const s = opts.store;

  app.get("/trenches/:chain", async (req, reply) => {
    const chain = String((req.params as { chain?: string }).chain ?? "");
    if (!TRENCH_CHAINS.has(chain)) return reply.code(404).send({ error: { code: "UNSUPPORTED_CHAIN", message: "Trenches baru tersedia untuk Solana" } });
    const doc = await s.getTrenches(chain);
    reply.header("cache-control", "public, max-age=5");
    if (!doc) return { items: [], counts: {}, updatedAt: null, pending: true, stale: true };
    return { ...doc, pending: false, stale: !(Date.now() - Date.parse(doc.updatedAt) < TRENCHES_STALE_MS) };
  });

  app.get("/perps", async (_req, reply) => {
    const doc = await s.getPerps();
    reply.header("cache-control", "public, max-age=15");
    if (!doc) return { perps: null, pending: true, stale: true };
    return { perps: doc, pending: false, stale: !(Date.now() - Date.parse(doc.updatedAt) < PERPS_STALE_MS) };
  });

  /**
   * Langkah 15: sumber data per chain. Mode A = provider pihak ketiga lewat worker bridge;
   * Mode B = indexer sendiri (butuh RPC/Geyser berbayar), belum diimplementasikan.
   */
  app.get("/status/data-sources", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=60");
    const geyser = !!process.env.SOLANA_GEYSER_URL;
    return {
      chains: ["solana", "base", "bsc"].map((chain) => ({
        chain,
        mode: "A",
        sources: ["geckoterminal", "dexscreener", chain === "solana" ? "solana-rpc" : "evm-rpc", "goplus"],
        indexer: chain === "solana" && geyser ? "configured_not_implemented" : "not_configured",
      })),
      perps: { source: "hyperliquid", mode: "A" },
    };
  });

  app.setErrorHandler((e, _req, reply) => {
    if (e instanceof StoreUnavailableError) return reply.code(503).send({ error: { code: "SERVICE_UNAVAILABLE", message: "Data pasar sementara tidak tersedia" } });
    throw e;
  });
}
