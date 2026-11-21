import assert from "node:assert/strict";
import { test } from "node:test";
import type { Token } from "@ot/types";
import { EMPTY_SECURITY } from "@ot/types";
import { alerts, perps, trenches } from "../src/index";

function curveBytes(realToken: bigint, complete: boolean): Uint8Array {
  const b = new Uint8Array(49);
  const v = new DataView(b.buffer);
  v.setBigUint64(8, 1_073_000_000_000_000n, true);
  v.setBigUint64(16, 30_000_000_000n, true);
  v.setBigUint64(24, realToken, true);
  v.setBigUint64(32, 0n, true);
  v.setBigUint64(40, 1_000_000_000_000_000n, true);
  b[48] = complete ? 1 : 0;
  return b;
}

test("Trenches: decode bonding curve dan progress", () => {
  const fresh = trenches.decodeCurve(curveBytes(trenches.PUMP_CURVE_TOKENS, false))!;
  assert.equal(trenches.curveProgress(fresh), 0);
  const mid = trenches.decodeCurve(curveBytes(trenches.PUMP_CURVE_TOKENS / 4n, false))!;
  assert.equal(Math.round(trenches.curveProgress(mid)), 75);
  const done = trenches.decodeCurve(curveBytes(0n, true))!;
  assert.equal(done.complete, true);
  assert.equal(trenches.curveProgress(done), 100);
  assert.equal(trenches.decodeCurve(new Uint8Array(10)), null);
});

test("Trenches FSM: created → final_stretch → migrated, dead bila sepi 24 jam, tidak mundur dari migrated", () => {
  const now = 1_000_000_000_000;
  const obs = (progress: number, extra: Partial<trenches.Observation> = {}) => ({ progress, complete: false, migrated: false, active: true, ...extra });
  assert.equal(trenches.nextStage(undefined, obs(10), now), "created");
  assert.equal(trenches.nextStage(undefined, obs(61), now), "final_stretch");
  assert.equal(trenches.nextStage({ stage: "final_stretch", lastActive: now }, obs(99, { complete: true }), now), "migrated");
  assert.equal(trenches.nextStage({ stage: "migrated", lastActive: now }, obs(5), now), "migrated");
  assert.equal(trenches.nextStage({ stage: "created", lastActive: now - trenches.DEAD_AFTER_MS - 1 }, obs(2, { active: false }), now), "dead");
  assert.equal(trenches.nextStage({ stage: "created", lastActive: now - trenches.DEAD_AFTER_MS - 1 }, obs(30, { active: false }), now), "created");
});

test("Perps: parse pasar, posisi, dan ringkasan bucket", () => {
  const m = perps.parseMarkets([
    { universe: [{ name: "BTC", maxLeverage: 40 }, { name: "OLD", maxLeverage: 3, isDelisted: true }] },
    [{ markPx: "100", prevDayPx: "80", dayNtlVlm: "1000", openInterest: "5", funding: "0.0001" }, { markPx: "1" }],
  ]);
  assert.equal(m.length, 1);
  assert.equal(m[0].change24hPct, 25);
  assert.equal(m[0].openInterestUsd, 500);
  assert.ok(Math.abs(m[0].fundingHourlyPct - 0.01) < 1e-9);

  const p = perps.parsePositions({
    assetPositions: [
      { position: { szi: "2", positionValue: "200", unrealizedPnl: "20", leverage: { value: 5 } } },
      { position: { szi: "-1", positionValue: "100", unrealizedPnl: "-10", leverage: { value: 2 } } },
    ],
  });
  assert.deepEqual([p.long, p.short, p.itm, p.underwater], [200, 100, 20, 10]);
  assert.equal(p.leverage, 4); // (200*5 + 100*2) / 300

  const wallets = [
    { address: "0xa", equity: 6e6, pnlAllTime: 2e6, volumeMonth: 1 },
    { address: "0xb", equity: 100, pnlAllTime: -50, volumeMonth: 1 },
  ];
  const s = perps.summarize(wallets, new Map([["0xa", p]]));
  const kraken = s.equity.find((b) => b.group === "Kraken")!;
  assert.deepEqual([kraken.wallets, kraken.sampled, kraken.inPositions, kraken.long], [1, 1, 1, 200]);
  assert.equal(s.equity.find((b) => b.group === "Shrimp")!.sampled, 0);
  const cell = s.heat.find((h) => h.equity === "Kraken" && h.pnl === "Money Printer")!;
  assert.ok(Math.abs(cell.longPct! - 66.666) < 0.01);
  assert.deepEqual(perps.pickSample(wallets, 1).map((w) => w.address).sort(), ["0xa", "0xb"]);
});

const token = (price: number, change1h: number | null, updatedAt = new Date(1_000_000).toISOString()): Token => ({
  chain: "solana", address: "Mint", symbol: "TST", name: "Test", logoUrl: null, logoColor: "#fff", ageMinutes: 1, price, priceNative: 0, marketCap: 0, fdv: 0, liquidity: 0,
  volume24h: 0, buyVolume24h: null, sellVolume24h: null, txns24h: 0, buys24h: 0, sells24h: 0, traders24h: null, change: { "5m": null, "1h": change1h, "4h": null, "24h": null },
  holders: null, top10Pct: null, maxSupply: 0, circulating: 0, markets: null, verified: false, isRwa: false, socials: {}, security: { ...EMPTY_SECURITY }, updatedAt, stale: false, mainPool: null, source: "test",
});

test("Alerts: kondisi harga, persen 1 jam, cooldown, dan data basi", () => {
  const now = 1_000_000 + 1000;
  const rule = (kind: "price_above" | "price_below" | "pct_change", threshold: number, lastFiredAt: number | null = null) => ({ kind, threshold, cooldownSec: 60, lastFiredAt });
  assert.ok(alerts.evaluate(rule("price_above", 1), token(1.5, null), now));
  assert.equal(alerts.evaluate(rule("price_above", 2), token(1.5, null), now), null);
  assert.ok(alerts.evaluate(rule("price_below", 2), token(1.5, null), now));
  assert.ok(alerts.evaluate(rule("pct_change", 10), token(1, -12), now)?.message.includes("turun"));
  assert.equal(alerts.evaluate(rule("pct_change", 10), token(1, 5), now), null);
  assert.equal(alerts.evaluate(rule("price_above", 1, now - 10_000), token(1.5, null), now), null); // cooldown
  assert.equal(alerts.evaluate(rule("price_above", 1), token(1.5, null), now + 10 * 60_000), null); // basi
});
