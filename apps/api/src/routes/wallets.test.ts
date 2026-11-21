import assert from "node:assert/strict";
import { test } from "node:test";
import type { TradersDoc } from "@ot/bridge";
import type { WalletProfile } from "@ot/types";
import { buildApp } from "../app";
import type { WalletStore } from "./wallets";

const EVM = "0xAbCdEf0123456789abcdef0123456789ABCDEF01";

test("Wallet & traders: validasi, view ditandai, pending lalu data", async () => {
  const views: string[] = [];
  const wallets = new Map<string, WalletProfile>();
  const docs = new Map<string, TradersDoc>();
  const store: WalletStore = {
    async getWallet(a) { return wallets.get(a) ?? null; },
    async getTraders(s) { return docs.get(s) ?? null; },
    async touchView(k, c, a) { views.push(`${k}:${c}:${a}`); },
  };
  const app = buildApp({ walletStore: store });
  assert.equal((await app.inject("/api/v1/wallets/not-an-address")).statusCode, 400);
  const pending = (await app.inject(`/api/v1/wallets/${EVM}`)).json<{ pending: boolean }>();
  assert.equal(pending.pending, true);
  assert.ok(views.includes(`wallet:any:${EVM.toLowerCase()}`));

  wallets.set(EVM.toLowerCase(), {
    address: EVM.toLowerCase(), kind: "evm", netWorthUsd: 10, holdings: [], tokens: [], activity: [], notes: [], updatedAt: new Date().toISOString(),
    pnl: { realizedUsd: 1, unrealizedUsd: 2, totalUsd: 3, winRate: null, tokensTraded: 0, volumeUsd: 0 },
  });
  const p = (await app.inject(`/api/v1/wallets/${EVM}`)).json<{ pending: boolean; profile: WalletProfile }>();
  assert.equal(p.pending, false);
  assert.equal(p.profile.pnl.totalUsd, 3);

  assert.equal((await app.inject("/api/v1/traders?token=base:nope")).statusCode, 400);
  docs.set("all", { items: [{ rank: 1, address: "W", pnlUsd: 5, roiPct: 1, winRate: 50, volumeUsd: 10, trades: 2, lastActiveMin: 1 }], updatedAt: new Date().toISOString(), tokens: 3 });
  const g = (await app.inject("/api/v1/traders")).json<{ items: unknown[]; tokens: number }>();
  assert.equal(g.items.length, 1);
  assert.equal(g.tokens, 3);
  const tk = (await app.inject("/api/v1/traders?token=base:0x4200000000000000000000000000000000000006")).json<{ pending: boolean }>();
  assert.equal(tk.pending, true);
  assert.ok(views.includes("trades:base:0x4200000000000000000000000000000000000006"));
  await app.close();
});
