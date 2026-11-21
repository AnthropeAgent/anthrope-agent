/**
 * GET /api/v1/search?q&chain&limit   (langkah 4, ARCHITECTURE §4.11)
 *
 * - Query berupa alamat (EVM 0x… / Solana base58): dicari langsung di cache Redis pada chain yang cocok.
 *   Alamat yang belum di-cache dicatat sebagai permintaan (worker mengambilnya) dan dikembalikan di `pending`
 *   supaya UI bisa menawarkan "buka alamat ini".
 * - Query teks: mesin search (Meilisearch, atau fallback Postgres pg_trgm) memberi kandidat →
 *   data pasar dari Redis → ranking akhir (simbol persis/awalan, lalu likuiditas, lalu volume).
 * - Tanpa mesin search (DB tidak ada): cocokkan di daftar trending + top MC yang sudah di-cache.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BRIDGE_CHAINS, isBridgeChain, isValidAddress, normAddress, StoreUnavailableError, type BridgeChain } from "@ot/bridge";
import { addressKind, matchTier, rankTokens, type SearchEngine } from "@ot/search";
import type { ApiError, Token } from "@ot/types";
import { withStale, type TokenStore } from "./tokens";

const SearchQuery = z.object({
  q: z.string().trim().min(1).max(100),
  chain: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

/** Kandidat yang diminta dari mesin sebelum ranking akhir (lebih banyak dari limit supaya ranking punya pilihan). */
const CANDIDATES = 50;

export interface SearchResponse {
  tokens: Token[];
  wallets: { address: string; label?: string }[];
  /** Alamat valid yang belum ada di cache; sedang diambil worker. */
  pending: { chain: string; address: string }[];
}

export async function searchRoutes(app: FastifyInstance, opts: { store: TokenStore; engine: SearchEngine | null }) {
  const s = opts.store;

  app.get("/search", async (req, reply) => {
    const parsed = SearchQuery.safeParse(req.query);
    if (!parsed.success) {
      const body: ApiError = { error: { code: "INVALID_QUERY", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } };
      return reply.code(400).send(body);
    }
    const { q, limit } = parsed.data;
    const chain = parsed.data.chain && parsed.data.chain !== "all" ? parsed.data.chain : undefined;
    const now = Date.now();
    const res: SearchResponse = { tokens: [], wallets: [], pending: [] };

    if (chain && !isBridgeChain(chain)) {
      reply.header("cache-control", "public, max-age=10");
      return res;
    }

    const kind = addressKind(q);
    if (kind) {
      const chains = (Object.keys(BRIDGE_CHAINS) as BridgeChain[]).filter(
        (c) => (!chain || c === chain) && BRIDGE_CHAINS[c].evm === (kind === "evm") && isValidAddress(c, q),
      );
      const keys = chains.map((c) => `${c}:${normAddress(c, q)}`);
      const found = await s.getTokens(keys);
      res.tokens = rankTokens(q, found).map((t) => withStale(t, now));
      // Belum ada di cache: minta worker mengambilnya. Untuk EVM chain tidak bisa ditebak, jadi semua chain EVM diminta.
      if (!found.length) {
        for (const c of chains) {
          const address = normAddress(c, q);
          await s.requestToken(c, address);
          res.pending.push({ chain: c, address });
        }
      }
      reply.header("cache-control", found.length ? "public, max-age=10" : "no-store");
      return res;
    }

    let pool: Token[] | null = null;
    if (opts.engine) {
      try {
        const refs = await opts.engine.candidates(q, { chain, limit: CANDIDATES });
        pool = await s.getTokens(refs.filter((r) => isBridgeChain(r.chain)).map((r) => `${r.chain}:${r.address}`));
      } catch (e) {
        if (e instanceof StoreUnavailableError) throw e;
        req.log.warn({ err: e, engine: opts.engine.kind }, "mesin search gagal; fallback ke daftar cache");
      }
    }
    if (!pool) {
      const lists = await Promise.all([s.getList(chain ?? "all", "trending"), s.getList(chain ?? "all", "top-mc")]);
      const keys = [...new Set(lists.flat())];
      pool = (await s.getTokens(keys)).filter((t) => matchTier(q, t) < 5);
    }
    res.tokens = rankTokens(q, pool)
      .slice(0, limit)
      .map((t) => withStale(t, now));
    reply.header("cache-control", "public, max-age=10");
    return res;
  });

  app.setErrorHandler((e, _req, reply) => {
    if (e instanceof StoreUnavailableError) {
      const body: ApiError = { error: { code: "SERVICE_UNAVAILABLE", message: "Data pasar sementara tidak tersedia" } };
      return reply.code(503).send(body);
    }
    throw e;
  });
}
