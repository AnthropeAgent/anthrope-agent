import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildToken, changedBars, cleanText, cleanUrl, dexscreener, geckoterminal, isValidAddress, newTrades, normAddress, priceFingerprint, RateLimiter, store } from "../src/index";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

test("GeckoTerminal: pool → GtPool dengan field dari base token", () => {
  const [p] = geckoterminal.parsePools("solana", fixture("gt-pools.json"));
  assert.equal(p.token.symbol, "FIONA");
  assert.equal(p.token.decimals, 6);
  assert.equal(p.dex, "pumpswap");
  assert.ok(p.priceUsd! > 0);
  assert.equal(p.marketCap, null); // provider mengirim null → tetap null
  assert.equal(typeof p.traders24h, "number");
  assert.ok(p.createdAt! > 0);
});

test("GeckoTerminal: nama/simbol/logo berbahaya disanitasi", () => {
  const evil = geckoterminal.parsePools("solana", fixture("gt-pools.json"))[1];
  assert.equal(evil.token.name, "scriptx/scriptLIVE");
  assert.equal(evil.token.symbol, "EVIL");
  assert.equal(evil.token.imageUrl, undefined);
});

test("DexScreener: pair → DsPair, hanya pair dengan token sebagai base", () => {
  const raw: unknown[] = fixture("ds-pairs-base.json");
  const pairs = raw.map((r) => dexscreener.parsePair("base", r)).filter((p) => p !== null);
  assert.equal(pairs.length, 3);
  assert.equal(pairs[0].base.address, "0x4200000000000000000000000000000000000006");
  assert.equal(pairs[0].base.symbol, "WETH");
  assert.equal(typeof pairs[0].liquidityUsd, "number");
});

test("buildToken: pair terlikuid jadi harga utama, volume dijumlah, field tak tersedia = null", () => {
  const raw: unknown[] = fixture("ds-pairs-base.json");
  const pairs = raw.map((r) => dexscreener.parsePair("base", r)!);
  const best = [...pairs].sort((a, b) => b.liquidityUsd! - a.liquidityUsd!)[0];
  const t = buildToken("base", pairs[0].base.address, pairs, undefined, 1_800_000_000_000)!;
  assert.equal(t.price, best.priceUsd);
  assert.equal(t.liquidity, best.liquidityUsd);
  assert.equal(Math.round(t.volume24h), Math.round(pairs.reduce((a, p) => a + p.volume24h!, 0)));
  assert.equal(t.markets, null);
  assert.equal(t.buyVolume24h, null);
  assert.equal(t.holders, null);
  assert.equal(t.change["4h"], null);
  assert.equal(t.security.mintRevoked, null);
  assert.equal(t.source, "dexscreener");
  assert.equal(t.updatedAt, new Date(1_800_000_000_000).toISOString());
});

test("buildToken: tanpa pair DexScreener memakai data GeckoTerminal; tanpa harga → null", () => {
  const [gt] = geckoterminal.parsePools("solana", fixture("gt-pools.json"));
  const t = buildToken("solana", gt.token.address, [], gt)!;
  assert.equal(t.symbol, "FIONA");
  assert.equal(t.source, "geckoterminal");
  assert.equal(t.marketCap, gt.fdv); // MC null → fallback FDV
  assert.equal(buildToken("solana", gt.token.address, [], { ...gt, priceUsd: null }), null);
});

test("validasi & normalisasi alamat per chain", () => {
  assert.ok(isValidAddress("solana", "So11111111111111111111111111111111111111112"));
  assert.ok(!isValidAddress("solana", "0x4200000000000000000000000000000000000006"));
  assert.ok(isValidAddress("base", "0x4200000000000000000000000000000000000006"));
  assert.equal(normAddress("bsc", "0xAbC0000000000000000000000000000000000001"), "0xabc0000000000000000000000000000000000001");
  assert.equal(normAddress("solana", "AbC"), "AbC");
});

test("sanitasi teks dan URL", () => {
  assert.equal(cleanText("A‮B<b>\u0000", 10), "ABb");
  assert.equal(cleanUrl("javascript:alert(1)"), undefined);
  assert.equal(cleanUrl("https://x.com/a"), "https://x.com/a");
});

test("RateLimiter memberi jarak antar panggilan", async () => {
  const l = new RateLimiter(50);
  const t0 = Date.now();
  const times: number[] = [];
  await Promise.all([1, 2, 3].map(() => l.schedule(async () => times.push(Date.now() - t0))));
  assert.ok(times[2] >= 95, `panggilan ke-3 di ${times[2]}ms`);
});

test("GeckoTerminal OHLCV: urut waktu naik, bar rusak dibuang", () => {
  const raw = fixture("gt-ohlcv.json");
  const cs = geckoterminal.parseOhlcv(raw);
  assert.equal(cs.length, 5);
  assert.ok(cs.every((c, i) => i === 0 || c.time > cs[i - 1].time));
  assert.ok(cs.every((c) => c.high >= c.low && c.volume >= 0));
  const broken = structuredClone(raw);
  broken.data.attributes.ohlcv_list.push([1, -1, 1, 1, 1, 1], ["x"], [cs[0].time, 1, 1, 1, 1, 1]);
  assert.equal(geckoterminal.parseOhlcv(broken).length, 5); // harga negatif, baris rusak, dan duplikat waktu
  assert.deepEqual(geckoterminal.parseOhlcv({}), []);
});

test("GeckoTerminal trades: sisi dari arah token, anomali & maker tidak valid dibuang", () => {
  const WETH = "0x4200000000000000000000000000000000000006";
  const raw = fixture("gt-trades-weth-base.json");
  const ts = geckoterminal.parseTrades("base", WETH, raw);
  assert.equal(ts.length, 4); // 2 jual + 2 beli; 1 anomali dan 1 maker "<script>" dibuang
  assert.equal(ts.filter((t) => t.side === "sell").length, 2);
  assert.equal(ts.filter((t) => t.side === "buy").length, 2);
  for (const t of ts) {
    assert.ok(t.priceUsd > 100, "harga = harga WETH, bukan USDC");
    assert.ok(Math.abs(t.amountToken * t.priceUsd - t.valueUsd) / t.valueUsd < 0.05);
    assert.match(t.id, /^base:0x[0-9a-f]{64}:\d+$/);
  }
  assert.ok(ts.every((t, i) => i === 0 || t.time <= ts[i - 1].time), "terbaru dulu");
  assert.deepEqual(geckoterminal.parseTrades("base", "0x0000000000000000000000000000000000000001", raw), []);
});

test("buildToken: mainPool = pair terlikuid", () => {
  const raw: unknown[] = fixture("ds-pairs-base.json");
  const pairs = raw.map((r) => dexscreener.parsePair("base", r)!);
  const best = [...pairs].sort((a, b) => b.liquidityUsd! - a.liquidityUsd!)[0];
  assert.equal(buildToken("base", pairs[0].base.address, pairs, undefined)!.mainPool, best.pairAddress);
});

test("realtime: trade baru, bar berubah, sidik jari harga", () => {
  const tr = (id: string) => ({ id, time: 1, side: "buy" as const, priceUsd: 1, amountToken: 1, valueUsd: 1, maker: "m", txHash: "h" });
  assert.deepEqual(newTrades(null, [tr("a")]).map((t) => t.id), ["a"]);
  assert.deepEqual(newTrades([tr("a")], [tr("b"), tr("a")]).map((t) => t.id), ["b"]);

  const bar = (time: number, close: number) => ({ time, open: 1, high: Math.max(1, close), low: 1, close, volume: 1 });
  assert.deepEqual(changedBars(null, [bar(60, 1)]), []);
  const prev = [bar(0, 1), bar(60, 1)];
  assert.deepEqual(changedBars(prev, [bar(0, 1), bar(60, 1)]), []);
  assert.deepEqual(changedBars(prev, [bar(0, 9), bar(60, 2), bar(120, 3)]).map((c) => c.time), [60, 120]); // bar lama tidak dikirim ulang

  const t = buildToken("solana", "So11111111111111111111111111111111111111112", [], geckoterminal.parsePools("solana", fixture("gt-pools.json"))[0], 1)!;
  const later = { ...t, updatedAt: new Date(2).toISOString() };
  assert.equal(priceFingerprint(store.priceUpdate(t)), priceFingerprint(store.priceUpdate(later)));
  assert.notEqual(priceFingerprint(store.priceUpdate(t)), priceFingerprint(store.priceUpdate({ ...t, price: t.price * 2 })));
});
