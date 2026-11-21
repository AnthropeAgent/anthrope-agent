/** Quote swap (Redis, TTL 30 dtk) dan order swap (Postgres `swap_orders`). */
import { postgres, redis } from "@ot/db";
import type { SwapQuote } from "@ot/swap";

export interface SwapOrderRow {
  id: string;
  chain: string;
  side: "buy" | "sell" | null;
  wallet: string;
  inputToken: string;
  outputToken: string;
  amountIn: string;
  expectedOut: string | null;
  minAmountOut: string;
  inputDecimals: number | null;
  outputDecimals: number | null;
  aggregator: string;
  status: "built" | "submitted" | "confirmed" | "failed";
  txSignature: string | null;
  createdAt: string;
}

export interface NewOrder {
  userId: string | null;
  quote: SwapQuote;
  wallet: string;
  expectedOut: string;
}

export interface SwapStore {
  putQuote(id: string, q: SwapQuote, ttlSec: number): Promise<void>;
  getQuote(id: string): Promise<SwapQuote | null>;
  /** null bila Postgres tidak tersedia (swap tetap jalan, hanya tidak tercatat). */
  createOrder(o: NewOrder): Promise<string | null>;
  /** "ok", "missing" (order tidak ada), atau "conflict" (sudah dilacak dengan tx lain). */
  trackOrder(id: string, txSignature: string): Promise<"ok" | "missing" | "conflict">;
  getOrder(id: string): Promise<SwapOrderRow | null>;
  listOrders(userId: string, limit: number): Promise<SwapOrderRow[]>;
}

const QKEY = (id: string) => `swap:quote:${id}`;

type Row = {
  id: string; chain_id: string; side: SwapOrderRow["side"]; wallet: string; input_token: string; output_token: string;
  amount_in: string; expected_out: string | null; min_amount_out: string; input_decimals: number | null; output_decimals: number | null;
  aggregator: string; status: SwapOrderRow["status"]; tx_signature: string | null; created_at: Date;
};
const COLS = `id, chain_id, side, wallet, input_token, output_token, amount_in::text, expected_out::text, min_amount_out::text,
  input_decimals, output_decimals, aggregator, status, tx_signature, created_at`;
const toOrder = (r: Row): SwapOrderRow => ({
  id: r.id, chain: r.chain_id, side: r.side, wallet: r.wallet, inputToken: r.input_token, outputToken: r.output_token,
  amountIn: r.amount_in, expectedOut: r.expected_out, minAmountOut: r.min_amount_out, inputDecimals: r.input_decimals,
  outputDecimals: r.output_decimals, aggregator: r.aggregator, status: r.status, txSignature: r.tx_signature, createdAt: r.created_at.toISOString(),
});

export const pgSwapStore: SwapStore = {
  async putQuote(id, q, ttl) {
    const r = redis();
    if (!r) throw new Error("redis tidak tersedia");
    await r.set(QKEY(id), JSON.stringify(q), "EX", ttl);
  },
  async getQuote(id) {
    const raw = await redis()?.get(QKEY(id));
    return raw ? (JSON.parse(raw) as SwapQuote) : null;
  },
  async createOrder(o) {
    const pg = postgres();
    if (!pg) return null;
    const q = o.quote;
    const { rows } = await pg.query<{ id: string }>(
      `INSERT INTO swap_orders (user_id, chain_id, side, wallet, input_token, output_token, amount_in, expected_out, min_amount_out,
         input_decimals, output_decimals, aggregator, fee_bps)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0) RETURNING id`,
      [o.userId, q.chain, q.side, o.wallet, q.inputToken, q.outputToken, q.amountIn, o.expectedOut, q.minAmountOut, q.inputDecimals, q.outputDecimals, q.aggregator],
    );
    return rows[0].id;
  },
  async trackOrder(id, sig) {
    const pg = postgres();
    if (!pg) return "missing";
    const u = await pg.query(
      `UPDATE swap_orders SET tx_signature = $2, status = 'submitted', updated_at = now()
        WHERE id = $1 AND (tx_signature IS NULL OR tx_signature = $2) AND status IN ('built', 'submitted')`,
      [id, sig],
    );
    if (u.rowCount) return "ok";
    const e = await pg.query("SELECT 1 FROM swap_orders WHERE id = $1", [id]);
    return e.rowCount ? "conflict" : "missing";
  },
  async getOrder(id) {
    const { rows } = (await postgres()?.query<Row>(`SELECT ${COLS} FROM swap_orders WHERE id = $1`, [id])) ?? { rows: [] };
    return rows[0] ? toOrder(rows[0]) : null;
  },
  async listOrders(userId, limit) {
    const { rows } = (await postgres()?.query<Row>(`SELECT ${COLS} FROM swap_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [userId, limit])) ?? {
      rows: [],
    };
    return rows.map(toOrder);
  },
};
