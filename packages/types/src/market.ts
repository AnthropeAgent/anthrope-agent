import type { ChainId } from "./chain";

export type Timeframe = "5m" | "1h" | "4h" | "24h";
export type DiscoverTab = "top-mc" | "trending" | "trenches" | "rwas";

/**
 * Field `null` = sumber data belum menyediakannya (bukan nol). UI menampilkan "_".
 * Kontrak lengkap: docs/api/openapi.yaml (schema Token).
 */
export interface Token {
  chain: ChainId;
  address: string;
  symbol: string;
  name: string;
  /** Logo dari provider; jika kosong UI memakai avatar warna `logoColor`. */
  logoUrl?: string | null;
  logoColor: string;
  ageMinutes: number;
  price: number;
  priceNative: number;
  marketCap: number;
  fdv: number;
  liquidity: number;
  volume24h: number;
  buyVolume24h: number | null;
  sellVolume24h: number | null;
  txns24h: number;
  buys24h: number;
  sells24h: number;
  traders24h: number | null;
  change: Record<Timeframe, number | null>;
  holders: number | null;
  top10Pct: number | null;
  maxSupply: number;
  circulating: number;
  /** Jumlah pair/pool aktif; null jika sumber tidak memberi jumlahnya. */
  markets: number | null;
  verified: boolean;
  isRwa: boolean;
  launchpad?: string;
  /** URL (http/https) */
  socials: { website?: string; x?: string; telegram?: string };
  security: {
    score?: number | null;
    mintRevoked: boolean | null;
    freezeRevoked: boolean | null;
    lpBurnedPct: number | null;
    honeypot: boolean | null;
    buyTax: number | null;
    sellTax: number | null;
  };
  /** Waktu data terakhir diperbarui (ISO). Kosong pada data mock. */
  updatedAt?: string;
  /** true jika updatedAt lebih tua dari ambang (ARCHITECTURE §8). */
  stale?: boolean;
  /** Pool terlikuid; sumber chart & trades di Mode A. Kosong pada data mock. */
  mainPool?: string | null;
  /** Asal data: "mock" atau nama provider (misal "dexscreener+geckoterminal"). */
  source?: string;
}

export const EMPTY_SECURITY: Token["security"] = {
  score: null,
  mintRevoked: null,
  freezeRevoked: null,
  lpBurnedPct: null,
  honeypot: null,
  buyTax: null,
  sellTax: null,
};

/** Satu bar. time = awal bar (unix detik), harga dalam USD, volume dalam USD. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Trade {
  id: string;
  time: number;
  side: "buy" | "sell";
  priceUsd: number;
  amountToken: number;
  valueUsd: number;
  maker: string;
  txHash: string;
  /** true jika transaksi sudah final (tidak bisa di-reorg). */
  final?: boolean;
}

export interface Holder {
  rank: number;
  address: string;
  label?: string;
  pct: number;
  amount: number;
  valueUsd: number;
  isContract?: boolean;
  locked?: boolean;
}

export interface TraderRow {
  rank: number;
  address: string;
  label?: string;
  pnlUsd: number;
  roiPct: number;
  winRate: number;
  volumeUsd: number;
  trades: number;
  lastActiveMin: number;
}

export type TrenchStage = "new" | "final" | "migrated";

export interface TrenchToken extends Token {
  stage: TrenchStage;
  bondingPct: number;
}

export interface PerpsBucket {
  range: string;
  group: string;
  /** Jumlah akun di segmen ini (populasi leaderboard). */
  wallets: number;
  /** Akun yang posisinya sudah dibaca; kolom posisi di bawah dihitung dari sampel ini. */
  sampled: number;
  inPositions: number;
  long: number;
  short: number;
  itm: number;
  underwater: number;
  leverage: number;
}

export interface PerpMarket {
  coin: string;
  markPx: number;
  change24hPct: number | null;
  volume24hUsd: number;
  openInterestUsd: number;
  /** Funding per jam, persen. */
  fundingHourlyPct: number;
  maxLeverage: number;
}

export interface PerpsHeatCell {
  equity: string;
  pnl: string;
  /** Porsi long dari total nilai posisi (%), null bila belum ada posisi tersampel. */
  longPct: number | null;
  sizeUsd: number;
}

/** Ringkasan perps (langkah 10, Hyperliquid). */
export interface PerpsDoc {
  source: "hyperliquid" | "mock";
  markets: PerpMarket[];
  equity: PerpsBucket[];
  pnl: PerpsBucket[];
  heat: PerpsHeatCell[];
  /** Akun di leaderboard / akun yang posisinya sudah dibaca. */
  wallets: number;
  sampled: number;
  updatedAt: string;
  leaderboardAt: string | null;
}

export interface Article {
  slug: string;
  title: string;
  excerpt: string;
  category: "flagship-reports" | "insight-articles" | "blog";
  tags: string[];
  date: string;
  readMin: number;
  hue: number;
  featured?: boolean;
  /** Dari CMS (langkah 12). */
  coverUrl?: string | null;
  author?: string | null;
  /** Isi Markdown; hanya ada di respons detail. */
  body?: string;
}

export interface ListTokensParams {
  tab: DiscoverTab;
  chain?: ChainId | "all";
  timeframe?: Timeframe;
  limit?: number;
}

// ---------- Holders & security (langkah 7) ----------
export type CheckStatus = "ok" | "warn" | "danger" | "unknown";

export interface SecurityCheck {
  key: string;
  label: string;
  status: CheckStatus;
  value: string;
}

export interface SecurityReport {
  chain: string;
  address: string;
  /** 0 (berbahaya) sampai 100 (bersih); null bila belum ada data sama sekali. */
  score: number | null;
  risk: "low" | "medium" | "high" | "unknown";
  checks: SecurityCheck[];
  flags: string[];
  summary: Token["security"];
  holderCount: number | null;
  top10Pct: number | null;
  creator: string | null;
  owner: string | null;
  source: string;
  scannedAt: string;
}

export interface HoldersSnapshot {
  items: Holder[];
  holderCount: number | null;
  /** % supply yang dipegang 10 holder teratas, tidak termasuk LP, burn, dan saldo terkunci. */
  top10Pct: number | null;
  source: string;
  updatedAt: string;
}

// ---------- Wallet analytics (langkah 8) ----------
export interface WalletHolding {
  chain: string;
  address: string;
  symbol: string;
  name: string;
  logoUrl?: string | null;
  amount: number;
  priceUsd: number | null;
  valueUsd: number | null;
  native?: boolean;
}

export interface WalletTokenPnl {
  chain: string;
  address: string;
  symbol: string;
  boughtUsd: number;
  soldUsd: number;
  realizedUsd: number;
  unrealizedUsd: number;
  pnlUsd: number;
  trades: number;
  lastTime: number;
}

export interface WalletActivity extends Trade {
  chain: string;
  token: string;
  symbol: string;
}

export interface WalletProfile {
  address: string;
  kind: "solana" | "evm";
  netWorthUsd: number;
  holdings: WalletHolding[];
  pnl: { realizedUsd: number; unrealizedUsd: number; totalUsd: number; winRate: number | null; tokensTraded: number; volumeUsd: number };
  tokens: WalletTokenPnl[];
  activity: WalletActivity[];
  /** Bagian yang tidak lengkap, misal saldo ERC-20 hanya untuk token yang dipantau. */
  notes: string[];
  updatedAt: string;
}

// ---------- alerts (langkah 11) ----------
export type AlertKind = "price_above" | "price_below" | "pct_change";

export interface AlertRule {
  id: string;
  kind: AlertKind;
  chain: string;
  address: string;
  /** Simbol saat alert dibuat (untuk tampilan). */
  symbol: string | null;
  /** price_* = harga USD; pct_change = persen perubahan 1 jam (nilai absolut). */
  threshold: number;
  channels: string[];
  cooldownSec: number;
  active: boolean;
  lastFiredAt: string | null;
  createdAt: string;
}

export interface AlertEvent {
  id: number;
  ruleId: string;
  kind: AlertKind;
  chain: string;
  address: string;
  firedAt: string;
  message: string;
  symbol: string | null;
  value: number;
  threshold: number;
}
