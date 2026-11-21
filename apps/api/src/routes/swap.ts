/**
 * Swap non-custodial (langkah 6, ARCHITECTURE §4.12):
 *
 * POST /api/v1/swap/quote        harga Buy/Sell dari aggregator, disimpan 30 dtk
 * POST /api/v1/swap/build        transaksi belum ditandatangani + pemeriksaan + simulasi wajib
 *                                (EVM: bila allowance kurang → transaksi approve sejumlah swap saja)
 * POST /api/v1/swap/track        catat tanda tangan/hash yang sudah dikirim wallet user
 * GET  /api/v1/swap/orders/{id}  status order (diperbarui worker)
 * GET  /api/v1/swap/balance      saldo native & token wallet (untuk tombol 25%/50%/100%)
 * GET  /api/v1/me/swaps          riwayat swap user yang login
 *
 * Server tidak pernah menandatangani atau mengirim transaksi.
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  balance,
  build,
  DEFAULT_SLIPPAGE_BPS,
  formatUnits,
  isAddressFor,
  isSwapChain,
  isTxId,
  MAX_SLIPPAGE_BPS,
  normAddr,
  quote,
  QUOTE_TTL_SEC,
  SWAP_CHAINS,
  SwapError,
  tokenDecimals,
  type Fetch,
  type SwapQuote,
} from "@ot/swap";
import type { ApiError } from "@ot/types";
import type { AuthStore } from "../auth/store";
import type { SwapOrderRow, SwapStore } from "../swap/store";
import { originAllowed, sessionUserId } from "./account";

export interface SwapOptions {
  store: SwapStore;
  auth: AuthStore;
  origins: string[];
  fetch: Fetch;
  enabled: boolean;
}

const RATE = { quote: 60, build: 20, balance: 60, windowSec: 60 };

const Chain = z.string().max(20).refine(isSwapChain, "chain belum didukung untuk swap");
const QuoteBody = z.object({
  chain: Chain,
  side: z.enum(["buy", "sell"]),
  token: z.string().max(64),
  amount: z.string().trim().max(48).regex(/^\d+(\.\d+)?$/, "jumlah harus angka"),
  slippageBps: z.coerce.number().int().min(1).max(MAX_SLIPPAGE_BPS).default(DEFAULT_SLIPPAGE_BPS),
});
const BuildBody = z.object({
  quoteId: z.string().regex(/^[a-f0-9]{32}$/),
  wallet: z.string().max(64),
  priorityFee: z.enum(["auto", "low", "medium", "high"]).default("auto"),
});
const TrackBody = z.object({ orderId: z.string().uuid(), txSignature: z.string().max(100) });
const BalanceQuery = z.object({ chain: Chain, wallet: z.string().max(64), token: z.string().max(64).optional() });

function err(reply: FastifyReply, status: number, code: string, message: string, extra?: Record<string, unknown>) {
  const body: ApiError & Record<string, unknown> = { error: { code, message }, ...extra };
  return reply.code(status).send(body);
}
const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");

/** Bentuk quote untuk klien: tanpa respons mentah aggregator, plus angka yang sudah diformat. */
function publicQuote(id: string, q: SwapQuote, expiresAt: Date) {
  const c = SWAP_CHAINS[q.chain];
  return {
    quoteId: id,
    chain: q.chain,
    side: q.side,
    aggregator: q.aggregator,
    nativeSymbol: c.native.symbol,
    inputToken: q.inputToken,
    outputToken: q.outputToken,
    inputDecimals: q.inputDecimals,
    outputDecimals: q.outputDecimals,
    amountIn: q.amountIn,
    amountOut: q.amountOut,
    minAmountOut: q.minAmountOut,
    amountInFormatted: formatUnits(q.amountIn, q.inputDecimals),
    amountOutFormatted: formatUnits(q.amountOut, q.outputDecimals),
    minAmountOutFormatted: formatUnits(q.minAmountOut, q.outputDecimals),
    slippageBps: q.slippageBps,
    priceImpactPct: q.priceImpactPct,
    route: q.route,
    feeBps: 0,
    expiresAt: expiresAt.toISOString(),
  };
}

export const publicOrder = (o: SwapOrderRow) => ({
  ...o,
  explorerUrl: o.txSignature && isSwapChain(o.chain) ? SWAP_CHAINS[o.chain].explorerTx + o.txSignature : null,
});

export async function swapRoutes(app: FastifyInstance, opts: SwapOptions) {
  const { store, auth, origins, fetch: f } = opts;

  app.addHook("onRequest", async (req, reply) => {
    reply.header("cache-control", "no-store");
    if (!req.url.includes("/swap/") && !req.url.includes("/me/swaps")) return;
    if (!opts.enabled) return err(reply, 503, "SWAP_DISABLED", "Swap sedang dinonaktifkan");
    if (req.method !== "GET" && !originAllowed(req, origins)) return err(reply, 403, "FORBIDDEN_ORIGIN", "Origin tidak diizinkan");
  });

  const limited = async (kind: keyof typeof RATE, ip: string) => auth.available() && !(await auth.hit(`swap-${kind}:${ip}`, RATE[kind] as number, RATE.windowSec));

  app.post("/swap/quote", async (req, reply) => {
    const b = QuoteBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, "INVALID_BODY", issues(b.error));
    if (await limited("quote", req.ip)) return err(reply, 429, "RATE_LIMITED", "Terlalu banyak permintaan quote, coba lagi sebentar");
    const q = await quote(f, { ...b.data, chain: b.data.chain as keyof typeof SWAP_CHAINS });
    const id = randomBytes(16).toString("hex");
    await store.putQuote(id, q, QUOTE_TTL_SEC);
    return publicQuote(id, q, new Date(Date.now() + QUOTE_TTL_SEC * 1000));
  });

  app.post("/swap/build", async (req, reply) => {
    const b = BuildBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, "INVALID_BODY", issues(b.error));
    if (await limited("build", req.ip)) return err(reply, 429, "RATE_LIMITED", "Terlalu banyak permintaan, coba lagi sebentar");
    const q = await store.getQuote(b.data.quoteId);
    if (!q) return err(reply, 410, "QUOTE_EXPIRED", "Quote kedaluwarsa; minta quote baru");
    if (!isAddressFor(q.chain, b.data.wallet)) return err(reply, 400, "INVALID_WALLET", "Alamat wallet tidak valid untuk chain ini");
    const wallet = normAddr(q.chain, b.data.wallet);

    const r = await build(f, q, wallet, b.data.priorityFee);
    if (r.kind === "evm-approval") {
      return { needsApproval: true, chain: q.chain, approvalTx: r.approval, message: "Izinkan router KyberSwap memakai token ini sejumlah swap, lalu ulangi." };
    }
    const userId = await sessionUserId(req, auth).catch(() => null);
    const orderId = await store.createOrder({ userId, quote: q, wallet, expectedOut: r.simulation.expectedOut }).catch((e) => {
      req.log.warn({ err: e }, "order swap tidak tercatat");
      return null;
    });
    req.log.info({ orderId, chain: q.chain, side: q.side, aggregator: q.aggregator }, "swap built");
    return {
      needsApproval: false,
      orderId,
      chain: q.chain,
      kind: r.kind,
      unsignedTx: r.tx,
      lastValidBlockHeight: r.kind === "solana" ? r.lastValidBlockHeight : null,
      simulation: {
        ...r.simulation,
        expectedOutFormatted: formatUnits(r.simulation.expectedOut, q.outputDecimals),
        minAmountOutFormatted: formatUnits(r.simulation.minAmountOut, q.outputDecimals),
      },
    };
  });

  app.post("/swap/track", async (req, reply) => {
    const b = TrackBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, "INVALID_BODY", issues(b.error));
    const o = await store.getOrder(b.data.orderId);
    if (!o) return err(reply, 404, "ORDER_NOT_FOUND", "Order tidak ditemukan");
    if (!isSwapChain(o.chain) || !isTxId(o.chain, b.data.txSignature)) return err(reply, 400, "INVALID_TX", "Format tanda tangan/hash transaksi tidak valid");
    const r = await store.trackOrder(o.id, b.data.txSignature);
    if (r === "missing") return err(reply, 404, "ORDER_NOT_FOUND", "Order tidak ditemukan");
    if (r === "conflict") return err(reply, 409, "ORDER_ALREADY_TRACKED", "Order sudah dicatat dengan transaksi lain");
    return reply.code(204).send();
  });

  app.get("/swap/orders/:id", async (req, reply) => {
    const p = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!p.success) return err(reply, 400, "INVALID_PARAMS", "id tidak valid");
    const o = await store.getOrder(p.data.id);
    return o ? publicOrder(o) : err(reply, 404, "ORDER_NOT_FOUND", "Order tidak ditemukan");
  });

  app.get("/swap/balance", async (req, reply) => {
    const q = BalanceQuery.safeParse(req.query);
    if (!q.success) return err(reply, 400, "INVALID_QUERY", issues(q.error));
    const chain = q.data.chain as keyof typeof SWAP_CHAINS;
    const c = SWAP_CHAINS[chain];
    if (!isAddressFor(chain, q.data.wallet) || (q.data.token && !isAddressFor(chain, q.data.token))) return err(reply, 400, "INVALID_ADDRESS", "Alamat tidak valid untuk chain ini");
    if (await limited("balance", req.ip)) return err(reply, 429, "RATE_LIMITED", "Terlalu banyak permintaan, coba lagi sebentar");
    const wallet = normAddr(chain, q.data.wallet);
    const token = q.data.token ? normAddr(chain, q.data.token) : null;
    const [nativeRaw, tokenRaw, tokenDec] = await Promise.all([
      balance(f, chain, wallet, c.native.address),
      token ? balance(f, chain, wallet, token) : null,
      token ? tokenDecimals(f, chain, token) : null,
    ]);
    return {
      native: { symbol: c.native.symbol, raw: nativeRaw, decimals: c.native.decimals, formatted: formatUnits(nativeRaw, c.native.decimals) },
      token: token && tokenRaw != null && tokenDec != null ? { address: token, raw: tokenRaw, decimals: tokenDec, formatted: formatUnits(tokenRaw, tokenDec) } : null,
    };
  });

  app.get("/me/swaps", async (req, reply) => {
    const userId = await sessionUserId(req, auth);
    if (!userId) return err(reply, 401, "UNAUTHENTICATED", "Belum login");
    return { items: (await store.listOrders(userId, 50)).map(publicOrder) };
  });

  app.setErrorHandler((e, req, reply) => {
    if (e instanceof SwapError) {
      if (e.status >= 500) req.log.warn({ code: e.code, msg: e.message }, "swap upstream");
      const logs = (e.detail as { logs?: string[] } | undefined)?.logs;
      return err(reply, e.status, e.code, e.message, logs ? { logs } : undefined);
    }
    throw e;
  });
}
