/**
 * Generator mock data yang deterministik (seeded), supaya SSR dan client
 * menghasilkan angka awal yang sama. Hanya dipakai lewat `provider.ts`.
 */
import { CHAINS, type ChainId } from "@/config/chains";
import type {
  Article,
  Candle,
  Holder,
  PerpsBucket,
  PerpsDoc,
  Token,
  TraderRow,
  Trade,
  TrenchStage,
  TrenchToken,
} from "./types";

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const HEX = "0123456789abcdef";

function makeAddress(r: () => number, chain: ChainId, pumpSuffix = false) {
  if (chain === "solana" || chain === "sui") {
    let s = "";
    for (let i = 0; i < 40; i++) s += B58[Math.floor(r() * B58.length)];
    return pumpSuffix ? s.slice(0, 40) + "pump" : s + "Xk9a";
  }
  let s = "0x";
  for (let i = 0; i < 40; i++) s += HEX[Math.floor(r() * 16)];
  return s;
}

const NAMES: [string, string][] = [
  ["NOVA", "Nova Protocol"], ["FIONA", "Fiona the Hippo"], ["RUGGED", "RUGGED"], ["DCTY", "DacityCoin"],
  ["FLOAT", "FLOAT"], ["XDP", "Doppler Finance"], ["VVV", "Venice Token"], ["ARK", "ARK"],
  ["PUMP", "Pump"], ["JUP", "Jupiter"], ["BONK", "Bonk"], ["WIF", "dogwifhat"], ["POPCAT", "Popcat"],
  ["AERO", "Aerodrome"], ["BRETT", "Brett"], ["DEGEN", "Degen"], ["TOSHI", "Toshi"], ["MOG", "Mog Coin"],
  ["PEPE", "Pepe"], ["CAKE", "PancakeSwap"], ["HYPE", "Hyperliquid"], ["KAITO", "Kaito"],
  ["ZEREBRO", "Zerebro"], ["GOAT", "Goatseus Maximus"], ["PNUT", "Peanut the Squirrel"],
  ["MEW", "cat in a dogs world"], ["GIGA", "Gigachad"], ["SPX", "SPX6900"], ["FARTCOIN", "Fartcoin"],
  ["AI16Z", "ai16z"], ["GRIFFAIN", "Griffain"], ["CHILLGUY", "Just a chill guy"], ["MOODENG", "Moo Deng"],
  ["LUNA", "Luna by Virtuals"], ["VIRTUAL", "Virtuals Protocol"], ["SUNDOG", "Sundog"],
];

const RWAS: [string, string][] = [
  ["TSLAx", "Tesla Tokenized Stock"], ["NVDAx", "NVIDIA Tokenized Stock"], ["AAPLx", "Apple Tokenized Stock"],
  ["SPYx", "S&P 500 ETF Tokenized"], ["QQQx", "Nasdaq 100 ETF Tokenized"], ["COINx", "Coinbase Tokenized Stock"],
  ["MSTRx", "MicroStrategy Tokenized"], ["USTBx", "US T-Bill Fund"], ["PAXG", "PAX Gold"], ["XAUT", "Tether Gold"],
];

function makeToken(seed: number, chain: ChainId, symbol: string, name: string, isRwa = false): Token {
  const r = rng(seed);
  const tier = r();
  const marketCap = isRwa
    ? 5e6 + r() * 4e8
    : tier > 0.85
      ? 1e8 + r() * 2e9
      : tier > 0.5
        ? 1e6 + r() * 9e7
        : 1e4 + r() * 2e6;
  const supply = isRwa ? 1e5 + r() * 5e6 : Math.pow(10, 8 + Math.floor(r() * 4));
  const price = marketCap / supply;
  const liquidity = marketCap * (0.02 + r() * 0.2);
  const volume24h = marketCap * (0.05 + r() * (tier < 0.5 ? 8 : 0.6));
  const buyShare = 0.35 + r() * 0.3;
  const txns24h = Math.round(volume24h / (50 + r() * 900));
  const buys = Math.round(txns24h * (0.4 + r() * 0.2));
  const vol = isRwa ? 0.03 : tier < 0.5 ? 1 : 0.2;
  const ch = (m: number) => (r() - 0.48) * 100 * vol * m;
  const chain0 = CHAINS.find((c) => c.id === chain)!;
  const pump = chain === "solana" && !isRwa && r() > 0.5;
  return {
    chain,
    address: makeAddress(r, chain, pump),
    symbol,
    name,
    logoColor: `hsl(${Math.floor(r() * 360)} 70% 55%)`,
    ageMinutes: isRwa ? 60 * 24 * (10 + r() * 300) : Math.pow(10, 1 + r() * 4.8),
    price,
    priceNative: price / (chain0.native === "SOL" ? 67.4 : chain0.native === "BNB" ? 580 : 1603),
    marketCap,
    fdv: marketCap * (1 + (r() > 0.6 ? r() * 2 : 0)),
    liquidity,
    volume24h,
    buyVolume24h: volume24h * buyShare,
    sellVolume24h: volume24h * (1 - buyShare),
    txns24h,
    buys24h: buys,
    sells24h: txns24h - buys,
    traders24h: Math.round(txns24h / (3 + r() * 8)),
    change: { "5m": ch(0.15), "1h": ch(0.4), "4h": ch(0.8), "24h": ch(2.5) },
    holders: r() > 0.15 ? Math.round(300 + r() * (tier > 0.85 ? 1.2e6 : 4e4)) : null,
    top10Pct: r() > 0.25 ? 12 + r() * 50 : null,
    maxSupply: supply,
    circulating: supply * (0.6 + r() * 0.4),
    markets: 1 + Math.floor(r() * 30),
    verified: r() > 0.55,
    isRwa,
    launchpad: pump ? "Pump.fun" : undefined,
    socials: {
      website: r() > 0.4 ? "https://example.com" : undefined,
      x: r() > 0.2 ? "https://x.com/example" : undefined,
      telegram: r() > 0.6 ? "https://t.me/example" : undefined,
    },
    security: {
      mintRevoked: r() > 0.15,
      freezeRevoked: r() > 0.1,
      lpBurnedPct: r() > 0.3 ? 100 : Math.round(r() * 100),
      honeypot: r() > 0.97,
      buyTax: r() > 0.85 ? Math.round(r() * 5) : 0,
      sellTax: r() > 0.85 ? Math.round(r() * 5) : 0,
    },
  };
}

const MAIN_CHAINS: ChainId[] = ["solana", "solana", "solana", "bsc", "base", "ethereum", "robinhood", "arbitrum"];

let _tokens: Token[] | null = null;
export function allTokens(): Token[] {
  if (_tokens) return _tokens;
  const list: Token[] = NAMES.map(([s, n], i) => makeToken(1000 + i * 97, MAIN_CHAINS[i % MAIN_CHAINS.length], s, n));
  RWAS.forEach(([s, n], i) =>
    list.push(makeToken(5000 + i * 31, (["solana", "robinhood", "ethereum"] as ChainId[])[i % 3], s, n, true)),
  );
  // SOL sebagai token referensi (dipakai link Supercharts)
  const sol = makeToken(42, "solana", "SOL", "Wrapped SOL");
  Object.assign(sol, {
    address: "So11111111111111111111111111111111111111112",
    price: 67.41, priceNative: 1, marketCap: 39.9e9, fdv: 43e9, liquidity: 4.04e9,
    volume24h: 2.78e9, buyVolume24h: 1.37e9, sellVolume24h: 1.41e9, holders: 9.1e6, ageMinutes: 60 * 24 * 365 * 5, verified: true, logoColor: "#9945FF",
  });
  list.unshift(sol);
  _tokens = list;
  return list;
}

export function trenchTokens(chain: ChainId): TrenchToken[] {
  const r = rng(hash("trench" + chain));
  const pads = chain === "solana" ? ["Pump.fun", "LetsBonk", "Moonshot", "Believe"] : chain === "bsc" ? ["Four.meme"] : ["Clanker", "Zora"];
  const out: TrenchToken[] = [];
  const stages: TrenchStage[] = ["new", "final", "migrated"];
  stages.forEach((stage, si) => {
    for (let i = 0; i < 14; i++) {
      const [s, n] = NAMES[Math.floor(r() * NAMES.length)];
      const t = makeToken(hash(chain + stage + i), chain, s.slice(0, 3) + Math.floor(r() * 99), n + " " + (i + 1));
      const mc = stage === "new" ? 3e3 + r() * 2e4 : stage === "final" ? 3e4 + r() * 4e4 : 7e4 + r() * 3e6;
      out.push({
        ...t,
        marketCap: mc,
        price: mc / 1e9,
        volume24h: mc * (0.2 + r() * 3),
        holders: Math.round(5 + r() * (stage === "migrated" ? 3000 : 300)),
        ageMinutes: stage === "new" ? 0.2 + r() * 8 : stage === "final" ? 5 + r() * 120 : 30 + r() * 900,
        launchpad: pads[Math.floor(r() * pads.length)],
        stage,
        bondingPct: stage === "new" ? r() * 40 : stage === "final" ? 60 + r() * 39 : 100,
      });
    }
    void si;
  });
  return out;
}

export function candlesFor(token: Token, intervalSec = 900, count = 240): Candle[] {
  const r = rng(hash(token.address + intervalSec));
  const now = Math.floor(Date.now() / 1000 / intervalSec) * intervalSec;
  const out: Candle[] = [];
  let p = token.price * (1 - (token.change["24h"] ?? 0) / 100);
  if (p <= 0) p = token.price;
  const drift = (Math.log(token.price) - Math.log(p)) / count;
  for (let i = count; i > 0; i--) {
    const open = p;
    const close = Math.max(open * Math.exp(drift + (r() - 0.5) * 0.04), 1e-12);
    const high = Math.max(open, close) * (1 + r() * 0.015);
    const low = Math.min(open, close) * (1 - r() * 0.015);
    out.push({ time: now - i * intervalSec, open, high, low, close, volume: (token.volume24h / 96) * (0.3 + r() * 1.7) });
    p = close;
  }
  // samakan harga terakhir
  const last = out[out.length - 1];
  const k = token.price / last.close;
  return out.map((c) => ({ ...c, open: c.open * k, high: c.high * k, low: c.low * k, close: c.close * k }));
}

export function tradesFor(token: Token, count = 40): Trade[] {
  const r = rng(hash(token.address + "trades"));
  const now = Math.floor(Date.now() / 1000);
  return Array.from({ length: count }, (_, i) => {
    const side = r() > 0.48 ? "buy" : "sell";
    const valueUsd = Math.pow(10, 1 + r() * 3.6);
    const priceUsd = token.price * (1 + (r() - 0.5) * 0.004);
    return {
      id: `${i}`,
      time: now - i * Math.round(2 + r() * 30),
      side,
      priceUsd,
      amountToken: valueUsd / priceUsd,
      valueUsd,
      maker: makeAddress(r, token.chain),
      txHash: makeAddress(r, token.chain),
    } as Trade;
  });
}

export function holdersFor(token: Token, count = 20): Holder[] {
  const r = rng(hash(token.address + "holders"));
  let left = token.top10Pct ?? 30;
  return Array.from({ length: count }, (_, i) => {
    const pct = i < 10 ? left * (0.2 + r() * 0.3) : r() * 0.8;
    if (i < 10) left -= pct;
    const amount = (token.circulating * pct) / 100;
    return {
      rank: i + 1,
      address: makeAddress(r, token.chain),
      label: i === 0 ? "Liquidity Pool" : i === 3 ? "CEX Hot Wallet" : undefined,
      pct,
      amount,
      valueUsd: amount * token.price,
    };
  });
}

export function topTraders(seed = "global", count = 25): TraderRow[] {
  const r = rng(hash(seed));
  const labels = ["Smart Money", "Sniper", "KOL", "Whale", "Insider", undefined, undefined];
  return Array.from({ length: count }, (_, i) => ({
    rank: i + 1,
    address: makeAddress(r, "solana"),
    label: labels[Math.floor(r() * labels.length)],
    pnlUsd: (r() > 0.15 ? 1 : -1) * Math.pow(10, 3 + r() * 3.5) * (1 - i / (count * 1.5)),
    roiPct: (r() - 0.2) * 600,
    winRate: 30 + r() * 65,
    volumeUsd: Math.pow(10, 4 + r() * 3),
    trades: Math.round(20 + r() * 3000),
    lastActiveMin: r() * 600,
  }));
}

export function perpsDoc(): PerpsDoc {
  const r = rng(77);
  const mk = (range: string, group: string, wallets: number): PerpsBucket => {
    const inPositions = Math.round(wallets * (0.05 + r() * 0.9));
    const long = Math.pow(10, 7 + r() * 2.5);
    const short = long * (0.3 + r() * 1.6);
    return { range, group, wallets, sampled: wallets, inPositions, long, short, itm: (long + short) * (0.03 + r() * 0.1), underwater: (long + short) * (0.04 + r() * 0.1), leverage: 2.5 + r() * 4.5 };
  };
  const b = {
    pnl: [
      mk("$1M to ∞", "Money Printer", 696), mk("$100K to $1M", "Smart Money", 3400), mk("$10K to $100K", "Grinder", 11960),
      mk("$0 to $10K", "Humble Gainer", 282160), mk("-$10K to 0", "Exit Liquidity", 1.1e6), mk("-$100K to -$10K", "Semi-Rekt", 34310),
      mk("-$1M to -$100K", "Full-Rekt", 7130), mk("-∞ to -$1M", "Giga-Rekt", 1050),
    ],
    equity: [
      mk("0 to $250", "Shrimp", 1.38e6), mk("$250 to $10K", "Fish", 47580), mk("$10K to $50K", "Dolphin", 6760),
      mk("$50K to $100K", "Apex", 1430), mk("$100K to $500K", "Small Whale", 1700), mk("$500K to $1M", "Whale", 345),
      mk("$1M to $5M", "Tidal Wave", 300), mk("$5M to ∞", "Kraken", 92),
    ],
  };
  return {
    source: "mock",
    markets: ["BTC", "ETH", "SOL", "HYPE"].map((coin, i) => ({ coin, markPx: [60000, 3000, 150, 30][i], change24hPct: r() * 10 - 5, volume24hUsd: 1e9 / (i + 1), openInterestUsd: 5e8 / (i + 1), fundingHourlyPct: 0.001, maxLeverage: 40 })),
    ...b,
    heat: b.equity.flatMap((e) => b.pnl.map((p) => ({ equity: e.group, pnl: p.group, longPct: 30 + r() * 40, sizeUsd: 1e6 }))),
    wallets: b.equity.reduce((a, x) => a + x.wallets, 0),
    sampled: b.equity.reduce((a, x) => a + x.wallets, 0),
    updatedAt: new Date().toISOString(),
    leaderboardAt: null,
  };
}

export function articles(): Article[] {
  return [
    { slug: "solana-q3-2026", coverUrl: "https://images.unsplash.com/photo-1660062993887-4938423dce59?w=1200&q=80&auto=format&fit=crop", title: "Solana Q3 2026: Where Conviction Compounds", excerpt: "Onchain activity, DEX volume and launchpad flows across the quarter.", category: "insight-articles", tags: ["Solana", "DEX"], date: "2026-10-14", readMin: 12, hue: 150, featured: true },
    { slug: "rwa-chain-specialization", coverUrl: "https://images.unsplash.com/photo-1626162987518-4fee900a9323?w=1200&q=80&auto=format&fit=crop", title: "The Specialized Market: RWAs Across Chains in H1 2026", excerpt: "Why tokenized assets cluster on specific chains, and what it means for liquidity.", category: "flagship-reports", tags: ["RWA", "Ethereum"], date: "2026-08-02", readMin: 18, hue: 265, featured: true },
    { slug: "solana-h1-2026", coverUrl: "https://images.unsplash.com/photo-1660062993674-c3830d07ca0a?w=1200&q=80&auto=format&fit=crop", title: "Solana H1 2026: Ready for the Next Leap", excerpt: "A half-year review of fees, users, and capital rotation.", category: "insight-articles", tags: ["Solana"], date: "2026-07-10", readMin: 10, hue: 30, featured: true },
    { slug: "prediction-markets", coverUrl: "https://images.unsplash.com/photo-1540910419892-4a36d2c3266c?w=1200&q=80&auto=format&fit=crop", title: "Beyond Betting: Prediction Markets as a Financial Primitive", excerpt: "Volume, open interest, and the rise of event-driven liquidity.", category: "flagship-reports", tags: ["Prediction Markets"], date: "2026-05-21", readMin: 15, hue: 200 },
    { slug: "internet-capital-markets", coverUrl: "https://images.unsplash.com/photo-1773266110858-acb9b6c43b15?w=1200&q=80&auto=format&fit=crop", title: "2025 in Review: The Year of Internet Capital Markets", excerpt: "Launchpads, DeFi infrastructure, and the new token issuance stack.", category: "flagship-reports", tags: ["DeFi", "Launchpad"], date: "2026-01-30", readMin: 22, hue: 15 },
    { slug: "rwa-spectrum", coverUrl: "https://images.unsplash.com/photo-1610375461246-83df859d849d?w=1200&q=80&auto=format&fit=crop", title: "Everything Onchain: A Spectrum of Real-World Assets", excerpt: "From treasuries to tokenized equities: mapping the RWA landscape.", category: "flagship-reports", tags: ["RWA"], date: "2025-12-12", readMin: 16, hue: 45 },
    { slug: "stablecoins-payments", coverUrl: "https://images.unsplash.com/photo-1628527304948-06157ee3c8a6?w=1200&q=80&auto=format&fit=crop", title: "From DeFi Backbone to Payments Layer: Stablecoins Evolve", excerpt: "Supply growth, velocity, and payment rails.", category: "flagship-reports", tags: ["Stablecoin", "Payment"], date: "2025-11-03", readMin: 14, hue: 180 },
    { slug: "monthly-roundup-oct", coverUrl: "https://images.unsplash.com/photo-1620266757065-5814239881fd?w=1200&q=80&auto=format&fit=crop", title: "Monthly Roundup: Sharper Signals, Wider Coverage", excerpt: "New chains, new screens, and faster alerts across the terminal.", category: "blog", tags: ["Product"], date: "2026-11-05", readMin: 3, hue: 26 },
    { slug: "one-domain", coverUrl: "https://images.unsplash.com/photo-1608222351212-18fe0ec7b13b?w=1200&q=80&auto=format&fit=crop", title: "One Domain for Every Product", excerpt: "Terminal, Peak, Research and Data now live under a single roof.", category: "blog", tags: ["Announcement"], date: "2026-10-29", readMin: 4, hue: 260 },
    { slug: "mobile-release", coverUrl: "https://images.unsplash.com/photo-1710345209036-e2406687a3f7?w=1200&q=80&auto=format&fit=crop", title: "Mobile v1.5: Wallet Intel, Smart Money, Alerts", excerpt: "Track wallets and set alerts on the go.", category: "blog", tags: ["Mobile"], date: "2026-10-10", readMin: 2, hue: 330 },
  ];
}
