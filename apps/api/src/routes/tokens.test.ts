import assert from "node:assert/strict";
import { test } from "node:test";
import { StoreUnavailableError, type Series } from "@ot/bridge";
import { EMPTY_SECURITY, type ApiError, type Candle, type Page, type SecurityReport, type Token, type Trade } from "@ot/types";
import { buildApp } from "../app";
import type { ScanReader, TokenStore } from "./tokens";

const SOL = "So11111111111111111111111111111111111111112";
const WETH = "0x4200000000000000000000000000000000000006";

function tok(chain: Token["chain"], address: string, over: Partial<Token> = {}): Token {
  return {
    chain, address, symbol: "T", name: "T", logoColor: "red", ageMinutes: 1, price: 1, priceNative: 1,
    marketCap: 1_000_000, fdv: 1_000_000, liquidity: 50_000, volume24h: 10_000, buyVolume24h: null, sellVolume24h: null,
    txns24h: 1, buys24h: 1, sells24h: 0, traders24h: null, change: { "5m": null, "1h": null, "4h": null, "24h": null },
    holders: null, top10Pct: null, maxSupply: 1, circulating: 1, markets: 1, verified: false, isRwa: false,
    socials: {}, security: { ...EMPTY_SECURITY }, updatedAt: new Date().toISOString(), ...over,
  };
}

function fakeStore(tokens: Token[], lists: Record<string, string[]>, series: Record<string, Series<unknown>> = {}) {
  const requested: string[] = [];
  const views: string[] = [];
  const store: TokenStore = {
    async getToken(c, a) { return tokens.find((t) => t.chain === c && t.address === a) ?? null; },
    async getTokens(keys) { return keys.map((k) => tokens.find((t) => `${t.chain}:${t.address}` === k)).filter((t): t is Token => !!t); },
    async getList(scope, tab) { return lists[`${scope}:${tab}`] ?? []; },
    async requestToken(c, a) { requested.push(`${c}:${a}`); },
    async getCandles(c, a, iv) { return (series[`ohlcv:${c}:${a}:${iv}`] as Series<Candle>) ?? null; },
    async getTradeSeries(c, a) { return (series[`trades:${c}:${a}`] as Series<Trade>) ?? null; },
    async touchView(kind, c, a) { views.push(`${kind}:${c}:${a}`); },
  };
  return { store, requested, views };
}

const tokens = [
  tok("solana", SOL, { marketCap: 5e9, liquidity: 1e7 }),
  tok("base", WETH, { marketCap: 9e9, liquidity: 5e3, updatedAt: new Date(Date.now() - 10 * 60_000).toISOString() }),
];
const lists = { "all:trending": [`base:${WETH}`, `solana:${SOL}`], "solana:trending": [`solana:${SOL}`] };

test("GET /tokens mengikuti urutan list, filter, dan menandai data basi", async () => {
  const app = buildApp({ tokenStore: fakeStore(tokens, lists).store });
  const all = (await app.inject("/api/v1/tokens?tab=trending")).json<Page<Token>>();
  assert.deepEqual(all.items.map((t) => t.chain), ["base", "solana"]);
  assert.equal(all.items[0].stale, true);
  assert.equal(all.items[1].stale, false);

  const filtered = (await app.inject("/api/v1/tokens?tab=trending&minLiquidity=10000")).json<Page<Token>>();
  assert.deepEqual(filtered.items.map((t) => t.chain), ["solana"]);

  const sol = (await app.inject("/api/v1/tokens?tab=trending&chain=solana")).json<Page<Token>>();
  assert.equal(sol.items.length, 1);
  await app.close();
});

test("GET /tokens: pagination cursor, rwas kosong, query invalid → 400", async () => {
  const app = buildApp({ tokenStore: fakeStore(tokens, lists).store });
  const p1 = (await app.inject("/api/v1/tokens?tab=trending&limit=1")).json<Page<Token>>();
  assert.equal(p1.items.length, 1);
  assert.ok(p1.nextCursor);
  const p2 = (await app.inject(`/api/v1/tokens?tab=trending&limit=1&cursor=${p1.nextCursor}`)).json<Page<Token>>();
  assert.equal(p2.items[0].chain, "solana");
  assert.equal(p2.nextCursor, null);

  assert.equal((await app.inject("/api/v1/tokens?tab=rwas")).json<Page<Token>>().items.length, 0);
  const bad = await app.inject("/api/v1/tokens?tab=nope&limit=999");
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json<ApiError>().error.code, "INVALID_QUERY");
  await app.close();
});

test("GET /tokens/{chain}/{address}: ada, belum di-cache (diminta), alamat/chain invalid", async () => {
  const { store, requested } = fakeStore(tokens, lists);
  const app = buildApp({ tokenStore: store });

  const ok = await app.inject(`/api/v1/tokens/base/${WETH.toUpperCase().replace("0X", "0x")}`);
  assert.equal(ok.statusCode, 200, "alamat EVM dinormalisasi ke lowercase");
  assert.equal(ok.json<Token>().address, WETH);

  const missing = await app.inject("/api/v1/tokens/solana/JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN");
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json<ApiError>().error.code, "TOKEN_NOT_FOUND");
  assert.deepEqual(requested, ["solana:JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"]);

  assert.equal((await app.inject("/api/v1/tokens/solana/0xnotsolana")).json<ApiError>().error.code, "INVALID_ADDRESS");
  assert.equal((await app.inject(`/api/v1/tokens/robinhood/${WETH}`)).json<ApiError>().error.code, "CHAIN_NOT_SUPPORTED");
  await app.close();
});

test("store tidak tersedia → 503 SERVICE_UNAVAILABLE", async () => {
  const down: TokenStore = {
    getToken: async () => { throw new StoreUnavailableError(); },
    getTokens: async () => { throw new StoreUnavailableError(); },
    getList: async () => { throw new StoreUnavailableError(); },
    requestToken: async () => { throw new StoreUnavailableError(); },
    getCandles: async () => { throw new StoreUnavailableError(); },
    getTradeSeries: async () => { throw new StoreUnavailableError(); },
    touchView: async () => { throw new StoreUnavailableError(); },
  };
  const app = buildApp({ tokenStore: down });
  const res = await app.inject("/api/v1/tokens");
  assert.equal(res.statusCode, 503);
  assert.equal(res.json<ApiError>().error.code, "SERVICE_UNAVAILABLE");
  await app.close();
});

const bar = (time: number, close: number): Candle => ({ time, open: close, high: close, low: close, close, volume: 10 });
const trade = (i: number, side: Trade["side"], valueUsd: number, maker = WETH): Trade => ({
  id: `base:0x${i}:0`, time: 1000 - i, side, priceUsd: 2, amountToken: valueUsd / 2, valueUsd, maker, txHash: `0x${i}`, final: true,
});

test("GET /ohlcv: menandai view, pending saat belum ada, filter waktu, unit mcap", async () => {
  const fresh = new Date().toISOString();
  const { store, views } = fakeStore([tok("solana", SOL, { price: 2, marketCap: 2000 })], {}, {
    [`ohlcv:solana:${SOL}:15m`]: { items: [bar(100, 1), bar(200, 2), bar(300, 3)], updatedAt: fresh, pool: "P" },
  });
  const app = buildApp({ tokenStore: store });

  const pending = await app.inject(`/api/v1/tokens/solana/${SOL}/ohlcv?interval=1h`);
  assert.equal(pending.statusCode, 200);
  assert.deepEqual(pending.json(), { items: [], interval: "1h", updatedAt: null, stale: true, pending: true, pool: null });
  assert.equal(pending.headers["retry-after"], "10");

  const r = (await app.inject(`/api/v1/tokens/solana/${SOL}/ohlcv?interval=15m&from=200`)).json<{ items: Candle[]; stale: boolean; pool: string }>();
  assert.deepEqual(r.items.map((c) => c.time), [200, 300]);
  assert.equal(r.stale, false);
  assert.equal(r.pool, "P");
  assert.deepEqual(views, [`ohlcv-1h:solana:${SOL}`, `ohlcv-15m:solana:${SOL}`]);

  const mc = (await app.inject(`/api/v1/tokens/solana/${SOL}/ohlcv?interval=15m&unit=mcap`)).json<{ items: Candle[] }>();
  assert.equal(mc.items[2].close, 3000); // close × (marketCap / price) = 3 × 1000

  const sec = await app.inject(`/api/v1/tokens/solana/${SOL}/ohlcv?interval=1s`);
  assert.equal(sec.json<ApiError>().error.code, "INTERVAL_NOT_SUPPORTED");
  assert.equal((await app.inject(`/api/v1/tokens/solana/${SOL}/ohlcv`)).statusCode, 400);
  await app.close();
});

test("GET /trades: filter sisi/nilai/maker, cursor, alamat EVM dinormalisasi", async () => {
  const other = "0x1111111111111111111111111111111111111111";
  const items = [trade(1, "buy", 500), trade(2, "sell", 50), trade(3, "buy", 5000, other), trade(4, "sell", 900)];
  const { store, views } = fakeStore([], {}, { [`trades:base:${WETH}`]: { items, updatedAt: new Date(0).toISOString(), pool: "P" } });
  const app = buildApp({ tokenStore: store });
  const url = `/api/v1/tokens/base/${WETH.toUpperCase().replace("0X", "0x")}/trades`;

  const all = (await app.inject(url)).json<{ items: Trade[]; stale: boolean; nextCursor: string | null }>();
  assert.equal(all.items.length, 4);
  assert.equal(all.stale, true); // updatedAt lama
  assert.deepEqual(views, [`trades:base:${WETH}`]);

  const buys = (await app.inject(`${url}?side=buy&minValueUsd=1000`)).json<{ items: Trade[] }>();
  assert.deepEqual(buys.items.map((t) => t.id), ["base:0x3:0"]);
  const byMaker = (await app.inject(`${url}?maker=${other.toUpperCase().replace("0X", "0x")}`)).json<{ items: Trade[] }>();
  assert.equal(byMaker.items.length, 1);

  const p1 = (await app.inject(`${url}?limit=3`)).json<{ items: Trade[]; nextCursor: string }>();
  const p2 = (await app.inject(`${url}?limit=3&cursor=${p1.nextCursor}`)).json<{ items: Trade[]; nextCursor: string | null }>();
  assert.deepEqual(p2.items.map((t) => t.id), ["base:0x4:0"]);
  assert.equal(p2.nextCursor, null);
  await app.close();
});

// ---------------------------------------------------------------- /search (langkah 4)
type SearchRes = { tokens: Token[]; wallets: unknown[]; pending: { chain: string; address: string }[] };
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const real = tok("solana", BONK, { symbol: "BONK", name: "Bonk", liquidity: 5e6 });
const fake = tok("base", "0x1111111111111111111111111111111111111111", { symbol: "BONK", name: "Bonk", liquidity: 300 });
const prefix = tok("bsc", "0x2222222222222222222222222222222222222222", { symbol: "BONKY", name: "Bonky", liquidity: 9e6 });

test("GET /search teks: kandidat mesin → ranking (simbol persis, lalu likuiditas), limit & filter chain", async () => {
  const asked: { q: string; chain?: string }[] = [];
  const engine = {
    kind: "postgres" as const,
    async candidates(q: string, o: { chain?: string; limit: number }) {
      asked.push({ q, chain: o.chain });
      return [prefix, fake, real, { chain: "ethereum", address: "0xdead" }].map((t) => ({ chain: t.chain, address: t.address }));
    },
  };
  const app = buildApp({ tokenStore: fakeStore([real, fake, prefix], {}).store, searchEngine: engine, bus: null });
  const r = await app.inject("/api/v1/search?q=%24bonk");
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json<SearchRes>().tokens.map((t) => t.symbol + "@" + t.chain), ["BONK@solana", "BONK@base", "BONKY@bsc"]);
  assert.equal((await app.inject("/api/v1/search?q=bonk&limit=1")).json<SearchRes>().tokens.length, 1);
  await app.inject("/api/v1/search?q=bonk&chain=solana");
  assert.equal(asked.at(-1)?.chain, "solana");
  assert.equal((await app.inject("/api/v1/search?q=bonk&chain=sui")).json<SearchRes>().tokens.length, 0);
  assert.equal((await app.inject("/api/v1/search?q=")).statusCode, 400);
  await app.close();
});

test("GET /search alamat: cocok di cache, atau dicatat sebagai pending untuk semua chain EVM", async () => {
  const { store, requested } = fakeStore([real], {});
  const app = buildApp({ tokenStore: store, searchEngine: null, bus: null });
  const hit = (await app.inject(`/api/v1/search?q=${BONK}`)).json<SearchRes>();
  assert.deepEqual(hit.tokens.map((t) => t.address), [BONK]);
  assert.deepEqual(hit.pending, []);

  const addr = "0xABCDEF0000000000000000000000000000000001";
  const miss = (await app.inject(`/api/v1/search?q=${addr}`)).json<SearchRes>();
  assert.equal(miss.tokens.length, 0);
  assert.deepEqual(miss.pending.map((p) => p.chain).sort(), ["base", "bsc"]);
  assert.equal(miss.pending[0].address, addr.toLowerCase());
  assert.deepEqual(requested.sort(), [`base:${addr.toLowerCase()}`, `bsc:${addr.toLowerCase()}`]);
  await app.close();
});

test("GET /search tanpa mesin / mesin gagal: fallback ke daftar trending + top MC", async () => {
  const broken = { kind: "meilisearch" as const, async candidates(): Promise<never> { throw new Error("down"); } };
  const lists2 = { "all:trending": [`solana:${BONK}`], "all:top-mc": [`bsc:${prefix.address}`, `solana:${BONK}`] };
  for (const engine of [null, broken]) {
    const app = buildApp({ tokenStore: fakeStore([real, prefix], lists2).store, searchEngine: engine, bus: null });
    const r = (await app.inject("/api/v1/search?q=bonk")).json<SearchRes>();
    assert.deepEqual(r.tokens.map((t) => t.symbol), ["BONK", "BONKY"]);
    assert.equal((await app.inject("/api/v1/search?q=zzz")).json<SearchRes>().tokens.length, 0);
    await app.close();
  }
});

test("Holders & security (langkah 7): pending sambil menandai view, lalu data scan menimpa field token", async () => {
  const f = fakeStore(tokens, lists);
  const report: SecurityReport = {
    chain: "solana", address: SOL, score: 82, risk: "low", checks: [], flags: ["metadata_mutable"],
    summary: { score: 82, mintRevoked: true, freezeRevoked: true, lpBurnedPct: null, honeypot: null, buyTax: null, sellTax: null },
    holderCount: 1234, top10Pct: 21.5, creator: null, owner: null, source: "goplus", scannedAt: new Date().toISOString(),
  };
  let have = false;
  const scans: ScanReader = {
    async getReport() { return have ? report : null; },
    async getHolders() { return have ? { items: [{ rank: 1, address: SOL, pct: 5, amount: 10, valueUsd: 10 }], holderCount: 1234, top10Pct: 21.5, source: "goplus", updatedAt: new Date().toISOString() } : null; },
  };
  const app = buildApp({ tokenStore: f.store, scanReader: scans });
  const pending = (await app.inject(`/api/v1/tokens/solana/${SOL}/holders`)).json<{ pending: boolean; items: unknown[] }>();
  assert.equal(pending.pending, true);
  assert.deepEqual(pending.items, []);
  assert.ok(f.views.includes(`holders:solana:${SOL}`));
  assert.equal((await app.inject(`/api/v1/tokens/solana/${SOL}/security`)).json<{ pending: boolean }>().pending, true);

  have = true;
  const h = (await app.inject(`/api/v1/tokens/solana/${SOL}/holders`)).json<{ pending: boolean; stale: boolean; items: unknown[] }>();
  assert.equal(h.pending, false);
  assert.equal(h.stale, false);
  assert.equal(h.items.length, 1);
  const t = (await app.inject(`/api/v1/tokens/solana/${SOL}`)).json<Token>();
  assert.equal(t.security.score, 82);
  assert.equal(t.security.mintRevoked, true);
  assert.equal(t.top10Pct, 21.5);
  assert.equal(t.holders, 1234);
  assert.equal((await app.inject(`/api/v1/tokens/base/0x123/holders`)).statusCode, 400);

  const noPg = buildApp({ tokenStore: f.store, scanReader: null });
  assert.equal((await noPg.inject(`/api/v1/tokens/solana/${SOL}/security`)).statusCode, 503);
  assert.equal((await noPg.inject(`/api/v1/tokens/solana/${SOL}`)).statusCode, 200);
  await app.close();
  await noPg.close();
});
