/**
 * Wallet analytics (langkah 8). Membaca Redis yang diisi worker (`traders`, `wallets`).
 *   GET /api/v1/wallets/{address}        profil wallet: net worth, holdings, PnL terpantau, aktivitas
 *   GET /api/v1/traders?scope=all        top traders global
 *   GET /api/v1/traders?token=chain:addr top traders satu token
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isBridgeChain, isValidAddress, normAddress, store, StoreUnavailableError, type TradersDoc, type ViewKind } from "@ot/bridge";
import type { ApiError, WalletProfile } from "@ot/types";

export interface WalletStore {
  getWallet(address: string): Promise<WalletProfile | null>;
  getTraders(scope: string): Promise<TradersDoc | null>;
  touchView(kind: ViewKind, chain: string, address: string): Promise<void>;
}
export const redisWalletStore: WalletStore = { getWallet: store.getWallet, getTraders: store.getTraders, touchView: store.touchView };

const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM = /^0x[0-9a-fA-F]{40}$/;
/** Profil lebih tua dari ini ditandai stale (worker refresh tiap 60 dtk selama dibuka). */
const WALLET_STALE_MS = 5 * 60_000;

const TradersQuery = z.object({
  scope: z.literal("all").optional(),
  token: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function walletRoutes(app: FastifyInstance, opts: { store: WalletStore }) {
  const s = opts.store;
  const err = (status: number, code: string, message: string): ApiError & { status: number } => ({ status, error: { code, message } });

  app.get("/wallets/:address", async (req, reply) => {
    const raw = String((req.params as { address?: string }).address ?? "");
    if (!SOL.test(raw) && !EVM.test(raw)) {
      const e = err(400, "INVALID_ADDRESS", "Alamat wallet tidak valid (Solana base58 atau EVM 0x…)");
      return reply.code(e.status).send({ error: e.error });
    }
    const address = EVM.test(raw) ? raw.toLowerCase() : raw;
    await s.touchView("wallet", "any", address);
    const p = await s.getWallet(address);
    reply.header("cache-control", "private, max-age=5");
    if (!p) {
      reply.header("retry-after", "5");
      return { profile: null, pending: true, stale: true };
    }
    return { profile: p, pending: false, stale: !(Date.now() - Date.parse(p.updatedAt) < WALLET_STALE_MS) };
  });

  app.get("/traders", async (req, reply) => {
    const q = TradersQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: { code: "INVALID_QUERY", message: "query tidak valid" } });
    let scope = "all";
    if (q.data.token) {
      const [chain, ...rest] = q.data.token.split(":");
      const addr = rest.join(":");
      if (!isBridgeChain(chain) || !isValidAddress(chain, addr)) return reply.code(400).send({ error: { code: "INVALID_TOKEN", message: "token harus chain:address" } });
      scope = `${chain}:${normAddress(chain, addr)}`;
      await s.touchView("trades", chain, normAddress(chain, addr)); // pastikan deret trades token ini diambil
    }
    const doc = await s.getTraders(scope);
    reply.header("cache-control", "public, max-age=15");
    if (!doc) return { items: [], updatedAt: null, tokens: 0, pending: true };
    return { items: doc.items.slice(0, q.data.limit), updatedAt: doc.updatedAt, tokens: doc.tokens, pending: false };
  });

  app.setErrorHandler((e, _req, reply) => {
    if (e instanceof StoreUnavailableError) return reply.code(503).send({ error: { code: "SERVICE_UNAVAILABLE", message: "Data wallet sementara tidak tersedia" } });
    throw e;
  });
}
