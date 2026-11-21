import assert from "node:assert/strict";
import { test } from "node:test";
import type { Trade } from "@ot/types";
import { traders } from "../src/index";

let n = 0;
const tr = (maker: string, side: "buy" | "sell", amount: number, price: number, time: number): Trade => ({
  id: String(n++), time, side, priceUsd: price, amountToken: amount, valueUsd: amount * price, maker, txHash: "h" + n,
});

test("Average cost: realized dari jual, unrealized dari sisa, jual tanpa beli terpantau tidak dihitung", () => {
  const trades = [
    tr("A", "buy", 100, 1, 1), tr("A", "buy", 100, 2, 2), // avg 1.5
    tr("A", "sell", 100, 3, 3), // realized (3-1.5)*100 = 150
    tr("B", "sell", 50, 2, 4), // dibeli sebelum jendela data → tidak ada realized
    tr("C", "buy", 10, 4, 5),
  ];
  const p = traders.positions(trades);
  assert.equal(p.get("A")!.realizedUsd, 150);
  assert.equal(p.get("A")!.qty, 100);
  assert.equal(p.get("B")!.realizedUsd, 0);
  const rows = traders.tokenTraders(trades, 2, 10_000);
  const a = rows.find((r) => r.address === "A")!;
  assert.equal(a.pnlUsd, 150 + (100 * 2 - 150)); // unrealized = 200 - 150
  assert.equal(a.rank, 1);
  assert.equal(a.winRate, 100);
  const c = rows.find((r) => r.address === "C")!;
  assert.equal(c.pnlUsd, -20);
  assert.ok(Math.abs(c.roiPct - -50) < 1e-9);
});

test("Global: gabung lintas token, win rate per token, filter noise", () => {
  const s1 = { chain: "solana", address: "T1", symbol: "T1", priceUsd: 2, trades: [tr("W", "buy", 10, 1, 1), tr("W", "sell", 10, 2, 2), tr("X", "buy", 1, 1, 3)] };
  const s2 = { chain: "base", address: "0xt2", symbol: "T2", priceUsd: 1, trades: [tr("W", "buy", 100, 2, 1), tr("W", "sell", 50, 1, 2)] };
  const rows = traders.globalTraders([s1, s2], 10_000, { minTrades: 2, minVolume: 10, limit: 10 });
  assert.deepEqual(rows.map((r) => r.address), ["W"]); // X: 1 trade → disaring
  assert.equal(rows[0].winRate, 50);
  assert.equal(rows[0].trades, 4);
});

test("Wallet: PnL per token + aktivitas, alamat EVM tidak peka huruf besar", () => {
  const s = { chain: "base", address: "0xt", symbol: "T", priceUsd: 3, trades: [tr("0xAbC", "buy", 10, 1, 1), tr("0xother", "buy", 1, 1, 2)] };
  const w = traders.walletPnl([s], "0xabc");
  assert.equal(w.tokens.length, 1);
  assert.equal(w.tokens[0].unrealizedUsd, 20);
  assert.equal(w.activity.length, 1);
  assert.equal(w.activity[0].symbol, "T");
});

test("Multicall3: encode aggregate3 & decode Result[]", async () => {
  const { wallet } = await import("../src/index");
  const data = wallet.encodeAggregate3([{ target: "0x" + "11".repeat(20), data: "0x313ce567" }]);
  assert.ok(data.startsWith("0x82ad56cb"));
  // head(0x20) + n + 1 offset + tuple(target, allowFailure, 0x60, len, 1 word data) = 8 words
  assert.equal((data.length - 10) / 64, 8);
  const w = (n: number) => n.toString(16).padStart(64, "0");
  // Result[] dengan 1 elemen: success=true, returnData = uint256(18)
  const ret = "0x" + w(0x20) + w(1) + w(0x20) + w(1) + w(0x40) + w(32) + w(18);
  const [r] = wallet.decodeAggregate3(ret);
  assert.equal(r.ok, true);
  assert.equal(BigInt(r.data), BigInt(18));
});
