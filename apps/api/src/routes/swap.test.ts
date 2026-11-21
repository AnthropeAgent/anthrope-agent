import assert from "node:assert/strict";
import { test } from "node:test";
import { KYBER_ROUTER, type Fetch, type SwapQuote } from "@ot/swap";
import { buildApp } from "../app";
import type { AuthStore } from "../auth/store";
import type { SwapOrderRow, SwapStore } from "../swap/store";

const ORIGIN = "http://localhost:3000";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WALLET = "0x00000000000000000000000000000000000000aa";

const noAuth = { available: () => false } as unknown as AuthStore;

function memSwapStore(): SwapStore & { quotes: Map<string, SwapQuote> } {
  const quotes = new Map<string, SwapQuote>();
  const orders = new Map<string, SwapOrderRow>();
  let n = 0;
  return {
    quotes,
    async putQuote(id, q) { quotes.set(id, q); },
    async getQuote(id) { return quotes.get(id) ?? null; },
    async createOrder(o) {
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      const q = o.quote;
      orders.set(id, {
        id, chain: q.chain, side: q.side, wallet: o.wallet, inputToken: q.inputToken, outputToken: q.outputToken, amountIn: q.amountIn,
        expectedOut: o.expectedOut, minAmountOut: q.minAmountOut, inputDecimals: q.inputDecimals, outputDecimals: q.outputDecimals,
        aggregator: q.aggregator, status: "built", txSignature: null, createdAt: new Date().toISOString(),
      });
      return id;
    },
    async trackOrder(id, sig) {
      const o = orders.get(id);
      if (!o) return "missing";
      if (o.txSignature && o.txSignature !== sig) return "conflict";
      Object.assign(o, { txSignature: sig, status: "submitted" });
      return "ok";
    },
    async getOrder(id) { return orders.get(id) ?? null; },
    async listOrders() { return [...orders.values()]; },
  };
}

const rpc = (result: unknown) => ({ jsonrpc: "2.0", id: 1, result });
const fakeFetch = (async (url: string, init: RequestInit = {}) => {
  const b = init.body ? JSON.parse(String(init.body)) : {};
  let out: unknown;
  if (url.includes("/routes?")) out = { code: 0, data: { routerAddress: KYBER_ROUTER, routeSummary: { amountIn: "1000000000000000", amountOut: "1600000", amountInUsd: "1.6", amountOutUsd: "1.6", route: [[{ exchange: "aerodrome" }]] } } };
  else if (url.includes("/route/build")) out = { code: 0, data: { routerAddress: KYBER_ROUTER, data: "0xabcdef", amountOut: "1600000", transactionValue: "1000000000000000" } };
  else if (b.method === "eth_call") out = rpc(b.params[0].data === "0x313ce567" ? "0x6" : "0x");
  else if (b.method === "eth_getBalance") out = rpc("0xde0b6b3a7640000");
  else if (b.method === "eth_estimateGas") out = rpc("0x5208");
  else throw new Error("tak terduga " + url);
  return new Response(JSON.stringify(out));
}) as unknown as Fetch;

function setup() {
  const store = memSwapStore();
  const app = buildApp({ swapStore: store, swapFetch: fakeFetch, authStore: noAuth, searchEngine: null, bus: null });
  const post = (url: string, payload: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
    app.inject({ method: "POST", url: `/api/v1${url}`, payload: payload as object, headers });
  return { app, store, post };
}

test("swap: quote → build (simulasi ok) → track → status order", async () => {
  const { app, post } = setup();
  const q = await post("/swap/quote", { chain: "base", side: "buy", token: TOKEN, amount: "0.001", slippageBps: 100 });
  assert.equal(q.statusCode, 200, q.body);
  const quote = q.json();
  assert.match(quote.quoteId, /^[a-f0-9]{32}$/);
  assert.equal(quote.amountOutFormatted, "1.6");
  assert.equal(quote.minAmountOutFormatted, "1.584");
  assert.equal(quote.raw, undefined); // respons mentah aggregator tidak dikirim

  const b = await post("/swap/build", { quoteId: quote.quoteId, wallet: WALLET });
  assert.equal(b.statusCode, 200, b.body);
  const built = b.json();
  assert.equal(built.unsignedTx.to, KYBER_ROUTER);
  assert.equal(built.simulation.ok, true);

  const hash = "0x" + "ab".repeat(32);
  assert.equal((await post("/swap/track", { orderId: built.orderId, txSignature: "nope" })).statusCode, 400);
  assert.equal((await post("/swap/track", { orderId: built.orderId, txSignature: hash })).statusCode, 204);
  assert.equal((await post("/swap/track", { orderId: built.orderId, txSignature: "0x" + "cd".repeat(32) })).statusCode, 409);
  const o = (await app.inject(`/api/v1/swap/orders/${built.orderId}`)).json();
  assert.equal(o.status, "submitted");
  assert.equal(o.explorerUrl, `https://basescan.org/tx/${hash}`);
  await app.close();
});

test("swap: validasi, quote kedaluwarsa, chain tidak didukung, CSRF", async () => {
  const { app, post } = setup();
  assert.equal((await post("/swap/quote", { chain: "sui", side: "buy", token: TOKEN, amount: "1" })).statusCode, 400);
  assert.equal((await post("/swap/quote", { chain: "base", side: "buy", token: TOKEN, amount: "1e9" })).statusCode, 400);
  assert.equal((await post("/swap/quote", { chain: "base", side: "buy", token: "So11111111111111111111111111111111111111112", amount: "1" })).json().error.code, "INVALID_TOKEN");
  assert.equal((await post("/swap/quote", { chain: "base", side: "buy", token: TOKEN, amount: "1", slippageBps: 9000 })).statusCode, 400);
  assert.equal((await post("/swap/build", { quoteId: "a".repeat(32), wallet: WALLET })).json().error.code, "QUOTE_EXPIRED");
  assert.equal((await post("/swap/quote", { chain: "base", side: "buy", token: TOKEN, amount: "1" }, { origin: "https://evil.example" })).statusCode, 403);
  assert.equal((await app.inject("/api/v1/me/swaps")).statusCode, 401);
  await app.close();
});
