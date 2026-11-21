/**
 * Wallet analytics Mode A (langkah 8): PnL dihitung dari transaksi yang DIPANTAU platform
 * (deret trades GeckoTerminal untuk pool utama token yang aktif), metode average cost (ARCHITECTURE §4.8).
 * Jual tanpa beli yang terpantau (dibeli sebelum jendela data) tidak dihitung ke realized PnL.
 * Mode B (indexer) menggantinya dengan riwayat penuh tanpa mengubah bentuk data.
 */
import type { TraderRow, Trade, WalletActivity, WalletTokenPnl } from "@ot/types";

export interface Position {
  qty: number;
  cost: number;
  boughtUsd: number;
  soldUsd: number;
  realizedUsd: number;
  trades: number;
  wins: number;
  sells: number;
  lastTime: number;
}

const empty = (): Position => ({ qty: 0, cost: 0, boughtUsd: 0, soldUsd: 0, realizedUsd: 0, trades: 0, wins: 0, sells: 0, lastTime: 0 });

/** Posisi per maker untuk satu token, dari trade terlama ke terbaru. */
export function positions(trades: Trade[]): Map<string, Position> {
  const out = new Map<string, Position>();
  const sorted = [...trades].sort((a, b) => a.time - b.time);
  for (const t of sorted) {
    if (!(t.amountToken > 0) || !(t.valueUsd >= 0) || !t.maker) continue;
    const p = out.get(t.maker) ?? empty();
    p.trades++;
    p.lastTime = Math.max(p.lastTime, t.time);
    if (t.side === "buy") {
      p.qty += t.amountToken;
      p.cost += t.valueUsd;
      p.boughtUsd += t.valueUsd;
    } else {
      p.soldUsd += t.valueUsd;
      p.sells++;
      const matched = Math.min(p.qty, t.amountToken);
      if (matched > 0) {
        const avg = p.cost / p.qty;
        const gain = (t.valueUsd / t.amountToken - avg) * matched;
        p.realizedUsd += gain;
        if (gain > 0) p.wins++;
        p.cost -= avg * matched;
        p.qty -= matched;
      }
    }
    out.set(t.maker, p);
  }
  return out;
}

export const unrealized = (p: Position, priceUsd: number) => (p.qty > 0 && priceUsd > 0 ? p.qty * priceUsd - p.cost : 0);

/** Top traders satu token (urut PnL). */
export function tokenTraders(trades: Trade[], priceUsd: number, now = Date.now(), limit = 100): TraderRow[] {
  return [...positions(trades)]
    .map(([address, p]) => {
      const pnl = p.realizedUsd + unrealized(p, priceUsd);
      return {
        rank: 0,
        address,
        pnlUsd: pnl,
        roiPct: p.boughtUsd > 0 ? (pnl / p.boughtUsd) * 100 : 0,
        winRate: p.sells ? (p.wins / p.sells) * 100 : 0,
        volumeUsd: p.boughtUsd + p.soldUsd,
        trades: p.trades,
        lastActiveMin: Math.max(0, (now / 1000 - p.lastTime) / 60),
      };
    })
    .sort((a, b) => b.pnlUsd - a.pnlUsd || b.volumeUsd - a.volumeUsd)
    .slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

export interface TokenSeries {
  chain: string;
  address: string;
  symbol: string;
  priceUsd: number;
  trades: Trade[];
}

/**
 * Top traders gabungan lintas token. Win rate = % token dengan PnL positif.
 * Wallet dengan < minTrades transaksi atau volume < minVolume diabaikan (anti-noise, §4.8).
 */
export function globalTraders(series: TokenSeries[], now = Date.now(), opts: { minTrades: number; minVolume: number; limit: number } = { minTrades: 2, minVolume: 100, limit: 100 }): TraderRow[] {
  const agg = new Map<string, { pnl: number; bought: number; vol: number; trades: number; tokens: number; won: number; last: number }>();
  for (const s of series) {
    for (const [maker, p] of positions(s.trades)) {
      const a = agg.get(maker) ?? { pnl: 0, bought: 0, vol: 0, trades: 0, tokens: 0, won: 0, last: 0 };
      const pnl = p.realizedUsd + unrealized(p, s.priceUsd);
      a.pnl += pnl;
      a.bought += p.boughtUsd;
      a.vol += p.boughtUsd + p.soldUsd;
      a.trades += p.trades;
      a.tokens++;
      if (pnl > 0) a.won++;
      a.last = Math.max(a.last, p.lastTime);
      agg.set(maker, a);
    }
  }
  return [...agg]
    .filter(([, a]) => a.trades >= opts.minTrades && a.vol >= opts.minVolume)
    .map(([address, a]) => ({
      rank: 0,
      address,
      label: a.pnl > 10_000 && a.tokens >= 3 && a.won / a.tokens > 0.6 ? "Smart Money" : undefined,
      pnlUsd: a.pnl,
      roiPct: a.bought > 0 ? (a.pnl / a.bought) * 100 : 0,
      winRate: (a.won / a.tokens) * 100,
      volumeUsd: a.vol,
      trades: a.trades,
      lastActiveMin: Math.max(0, (now / 1000 - a.last) / 60),
    }))
    .sort((a, b) => b.pnlUsd - a.pnlUsd)
    .slice(0, opts.limit)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** PnL & aktivitas satu wallet dari semua deret yang dipantau. Alamat EVM dibandingkan lowercase. */
export function walletPnl(series: TokenSeries[], wallet: string, maxActivity = 100): { tokens: WalletTokenPnl[]; activity: WalletActivity[] } {
  const evm = wallet.startsWith("0x");
  const same = (m: string) => (evm ? m.toLowerCase() === wallet.toLowerCase() : m === wallet);
  const tokens: WalletTokenPnl[] = [];
  const activity: WalletActivity[] = [];
  for (const s of series) {
    const mine = s.trades.filter((t) => same(t.maker));
    if (!mine.length) continue;
    const p = positions(mine).values().next().value as Position;
    const u = unrealized(p, s.priceUsd);
    tokens.push({ chain: s.chain, address: s.address, symbol: s.symbol, boughtUsd: p.boughtUsd, soldUsd: p.soldUsd, realizedUsd: p.realizedUsd, unrealizedUsd: u, pnlUsd: p.realizedUsd + u, trades: p.trades, lastTime: p.lastTime });
    for (const t of mine) activity.push({ ...t, chain: s.chain, token: s.address, symbol: s.symbol });
  }
  tokens.sort((a, b) => b.lastTime - a.lastTime);
  activity.sort((a, b) => b.time - a.time);
  return { tokens, activity: activity.slice(0, maxActivity) };
}
