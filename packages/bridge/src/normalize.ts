/**
 * Gabungkan data provider menjadi satu `Token` (bentuk yang sama dengan indexer sendiri nanti).
 * Prinsip: field yang tidak disediakan provider = null, tidak dikarang.
 *
 * Catatan DexScreener `tokens/v1`: hanya mengembalikan SATU pair (paling likuid) per token,
 * jadi volume/txns = angka pair utama (sedikit di bawah total semua pool) dan jumlah pasar tidak diketahui.
 */
import { EMPTY_SECURITY, type Token } from "@ot/types";
import type { BridgeChain } from "./chains";
import type { DsPair } from "./dexscreener";
import type { GtPool } from "./geckoterminal";

/** Warna avatar fallback yang stabil per alamat. */
export function colorFor(address: string): string {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 60%)`;
}

const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

export function buildToken(chain: BridgeChain, address: string, pairs: DsPair[], gt: GtPool | undefined, now = Date.now()): Token | null {
  const best = [...pairs].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))[0];
  const price = best?.priceUsd ?? gt?.priceUsd ?? null;
  if (price == null || price <= 0) return null;

  const fdvRaw = best?.fdv ?? gt?.fdv ?? null;
  const mcapRaw = best?.marketCap ?? gt?.marketCap ?? fdvRaw;
  const marketCap = mcapRaw ?? 0;
  const fdv = fdvRaw ?? marketCap;
  const change = best?.change ?? gt?.change;
  const created = [...pairs.map((p) => p.createdAt), gt?.createdAt ?? null].filter((x): x is number => x != null && x > 0);
  const buys = pairs.length ? sum(pairs.map((p) => p.buys24h)) : (gt?.buys24h ?? 0);
  const sells = pairs.length ? sum(pairs.map((p) => p.sells24h)) : (gt?.sells24h ?? 0);
  const withSocials = pairs.find((p) => p.socials.website || p.socials.x || p.socials.telegram);
  const sources = [pairs.length ? "dexscreener" : null, gt ? "geckoterminal" : null].filter(Boolean);

  return {
    chain,
    address,
    symbol: best?.base.symbol ?? gt?.token.symbol ?? "?",
    name: best?.base.name ?? gt?.token.name ?? "Unknown",
    logoUrl: best?.imageUrl ?? pairs.find((p) => p.imageUrl)?.imageUrl ?? gt?.token.imageUrl ?? null,
    logoColor: colorFor(address),
    ageMinutes: created.length ? Math.max(0, Math.round((now - Math.min(...created)) / 60_000)) : 0,
    price,
    priceNative: best?.priceNative ?? gt?.priceNative ?? 0,
    marketCap,
    fdv,
    liquidity: best?.liquidityUsd ?? gt?.liquidityUsd ?? 0,
    volume24h: pairs.length ? sum(pairs.map((p) => p.volume24h)) : (gt?.volume24h ?? 0),
    buyVolume24h: null, // tidak disediakan provider gratis; diisi indexer (Mode B) / ClickHouse
    sellVolume24h: null,
    txns24h: buys + sells,
    buys24h: buys,
    sells24h: sells,
    traders24h: gt?.traders24h ?? null, // unique trader pool teratas di GeckoTerminal
    change: { "5m": change?.m5 ?? null, "1h": change?.h1 ?? null, "4h": null, "24h": change?.h24 ?? null },
    holders: null,
    top10Pct: null,
    maxSupply: fdv / price,
    circulating: marketCap / price,
    markets: null, // tokens/v1 hanya memberi pair utama; jumlah pasar asli butuh token-pairs/indexer
    verified: false,
    isRwa: false,
    socials: withSocials?.socials ?? {},
    security: { ...EMPTY_SECURITY },
    updatedAt: new Date(now).toISOString(),
    stale: false,
    mainPool: best?.pairAddress ?? gt?.poolAddress ?? null,
    source: sources.join("+"),
  };
}
