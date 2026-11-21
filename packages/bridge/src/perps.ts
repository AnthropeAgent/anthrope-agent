/**
 * Perps (langkah 10): Hyperliquid, API publik tanpa key.
 *  - Pasar: POST /info {type: "metaAndAssetCtxs"} → harga, funding, OI, volume.
 *  - Populasi wallet: leaderboard (stats-data) → equity & PnL all-time semua akun (±46K, ±38 MB).
 *  - Posisi: POST /info {type: "clearinghouseState", user} per wallet sampel (bergiliran).
 * Bagian murni (parse, bucket, ringkasan) diekspor untuk tes.
 */
import type { PerpMarket, PerpsBucket, PerpsHeatCell } from "@ot/types";
import { fetchJson, RateLimiter } from "./http";
import { cleanText, num } from "./sanitize";

const INFO = "https://api.hyperliquid.xyz/info";
const LEADERBOARD = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";
/** Batas publik 1200 weight/menit per IP; clearinghouseState = weight 2. Kita pakai jauh di bawahnya. */
const limiter = new RateLimiter(400);

async function info<T>(body: object): Promise<T> {
  const res = await limiter.schedule(() =>
    fetch(INFO, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) }),
  );
  if (!res.ok) throw new Error(`hyperliquid HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ---------- pasar ----------
type RawMeta = [{ universe: { name: string; maxLeverage: number; isDelisted?: boolean }[] }, Record<string, string | null>[]];

export function parseMarkets(raw: RawMeta): PerpMarket[] {
  const [meta, ctxs] = raw;
  const out: PerpMarket[] = [];
  meta.universe.forEach((u, i) => {
    const c = ctxs[i];
    if (!c || u.isDelisted) return;
    const mark = num(c.markPx);
    const prev = num(c.prevDayPx);
    if (mark == null || mark <= 0) return;
    out.push({
      coin: cleanText(u.name, 20),
      markPx: mark,
      change24hPct: prev ? ((mark - prev) / prev) * 100 : null,
      volume24hUsd: num(c.dayNtlVlm) ?? 0,
      openInterestUsd: (num(c.openInterest) ?? 0) * mark,
      fundingHourlyPct: (num(c.funding) ?? 0) * 100,
      maxLeverage: u.maxLeverage,
    });
  });
  return out.sort((a, b) => b.volume24hUsd - a.volume24hUsd);
}

export async function markets(): Promise<PerpMarket[]> {
  return parseMarkets(await info<RawMeta>({ type: "metaAndAssetCtxs" }));
}

// ---------- populasi wallet ----------
export interface HlWallet {
  address: string;
  equity: number;
  pnlAllTime: number;
  volumeMonth: number;
}

interface RawLeaderboard {
  leaderboardRows?: { ethAddress: string; accountValue: string; windowPerformances: [string, { pnl: string; vlm: string }][] }[];
}

export function parseLeaderboard(raw: RawLeaderboard): HlWallet[] {
  const out: HlWallet[] = [];
  for (const r of raw.leaderboardRows ?? []) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(r.ethAddress)) continue;
    const w = Object.fromEntries(r.windowPerformances ?? []);
    out.push({ address: r.ethAddress.toLowerCase(), equity: num(r.accountValue) ?? 0, pnlAllTime: num(w.allTime?.pnl) ?? 0, volumeMonth: num(w.month?.vlm) ?? 0 });
  }
  return out;
}

export async function leaderboard(): Promise<HlWallet[]> {
  return parseLeaderboard(await fetchJson<RawLeaderboard>(LEADERBOARD, { provider: "hyperliquid", limiter: new RateLimiter(0), timeoutMs: 90_000, retries: 1 }));
}

// ---------- posisi wallet ----------
export interface HlPositions {
  long: number;
  short: number;
  /** Total unrealized PnL posisi yang untung / rugi (nilai absolut). */
  itm: number;
  underwater: number;
  /** Rata-rata leverage tertimbang nilai posisi. */
  leverage: number | null;
  at: number;
}

interface RawState {
  assetPositions?: { position: { szi: string; positionValue: string; unrealizedPnl: string; leverage?: { value: number } } }[];
}

export function parsePositions(raw: RawState, at = Date.now()): HlPositions {
  let long = 0, short = 0, itm = 0, underwater = 0, levW = 0;
  for (const { position: p } of raw.assetPositions ?? []) {
    const size = num(p.szi) ?? 0;
    const value = Math.abs(num(p.positionValue) ?? 0);
    const upnl = num(p.unrealizedPnl) ?? 0;
    if (!size || !value) continue;
    if (size > 0) long += value;
    else short += value;
    if (upnl >= 0) itm += upnl;
    else underwater -= upnl;
    levW += value * (p.leverage?.value ?? 1);
  }
  const total = long + short;
  return { long, short, itm, underwater, leverage: total ? levW / total : null, at };
}

export async function positions(user: string): Promise<HlPositions> {
  return parsePositions(await info<RawState>({ type: "clearinghouseState", user }));
}

// ---------- bucket ----------
interface Def {
  range: string;
  group: string;
  min: number;
}
export const EQUITY_BUCKETS: Def[] = [
  { range: "$5M to ∞", group: "Kraken", min: 5e6 },
  { range: "$1M to $5M", group: "Tidal Wave", min: 1e6 },
  { range: "$500K to $1M", group: "Whale", min: 5e5 },
  { range: "$100K to $500K", group: "Small Whale", min: 1e5 },
  { range: "$50K to $100K", group: "Apex", min: 5e4 },
  { range: "$10K to $50K", group: "Dolphin", min: 1e4 },
  { range: "$250 to $10K", group: "Fish", min: 250 },
  { range: "0 to $250", group: "Shrimp", min: -Infinity },
];
export const PNL_BUCKETS: Def[] = [
  { range: "$1M to ∞", group: "Money Printer", min: 1e6 },
  { range: "$100K to $1M", group: "Smart Money", min: 1e5 },
  { range: "$10K to $100K", group: "Grinder", min: 1e4 },
  { range: "$0 to $10K", group: "Humble Gainer", min: 0 },
  { range: "-$10K to 0", group: "Exit Liquidity", min: -1e4 },
  { range: "-$100K to -$10K", group: "Semi-Rekt", min: -1e5 },
  { range: "-$1M to -$100K", group: "Full-Rekt", min: -1e6 },
  { range: "-∞ to -$1M", group: "Giga-Rekt", min: -Infinity },
];
export const groupOf = (defs: Def[], v: number) => defs.find((d) => v >= d.min)!.group;

/**
 * Pilih wallet yang posisinya dipantau: `perBucket` akun teraktif (volume 30 hari) per segmen equity,
 * diselang-seling antar segmen supaya semua segmen cepat terisi saat worker baru mulai.
 */
export function pickSample(wallets: HlWallet[], perBucket = 300): HlWallet[] {
  const by = new Map<string, HlWallet[]>();
  for (const w of wallets) {
    const g = groupOf(EQUITY_BUCKETS, w.equity);
    by.set(g, [...(by.get(g) ?? []), w]);
  }
  const lists = [...by.values()].map((ws) => ws.sort((a, b) => b.volumeMonth - a.volumeMonth).slice(0, perBucket));
  const out: HlWallet[] = [];
  for (let i = 0; i < perBucket; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

/**
 * Ringkas per bucket. `wallets` = jumlah akun di leaderboard (populasi penuh);
 * kolom posisi dihitung dari wallet sampel yang sudah dibaca (`sampled`).
 */
export function summarize(all: HlWallet[], pos: Map<string, HlPositions>): { equity: PerpsBucket[]; pnl: PerpsBucket[]; heat: PerpsHeatCell[] } {
  const mk = (defs: Def[], key: (w: HlWallet) => number): PerpsBucket[] =>
    defs.map((d) => {
      const ws = all.filter((w) => groupOf(defs, key(w)) === d.group);
      const b: PerpsBucket = { range: d.range, group: d.group, wallets: ws.length, sampled: 0, inPositions: 0, long: 0, short: 0, itm: 0, underwater: 0, leverage: 0 };
      let levW = 0;
      for (const w of ws) {
        const p = pos.get(w.address);
        if (!p) continue;
        b.sampled++;
        if (p.long + p.short > 0) b.inPositions++;
        b.long += p.long;
        b.short += p.short;
        b.itm += p.itm;
        b.underwater += p.underwater;
        levW += (p.leverage ?? 0) * (p.long + p.short);
      }
      b.leverage = b.long + b.short ? levW / (b.long + b.short) : 0;
      return b;
    });
  const heat: PerpsHeatCell[] = [];
  for (const e of EQUITY_BUCKETS)
    for (const q of PNL_BUCKETS) {
      let long = 0, short = 0;
      for (const w of all) {
        if (groupOf(EQUITY_BUCKETS, w.equity) !== e.group || groupOf(PNL_BUCKETS, w.pnlAllTime) !== q.group) continue;
        const p = pos.get(w.address);
        if (p) (long += p.long), (short += p.short);
      }
      heat.push({ equity: e.group, pnl: q.group, longPct: long + short ? (long / (long + short)) * 100 : null, sizeUsd: long + short });
    }
  return { equity: mk(EQUITY_BUCKETS, (w) => w.equity), pnl: mk(PNL_BUCKETS, (w) => w.pnlAllTime), heat };
}
