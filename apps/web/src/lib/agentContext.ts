import type { Token } from "@/lib/data/types";

/** Ringkas token untuk konteks agent (hemat token, tanpa field UI). */
export function tokenBrief(t: Token) {
  return {
    chain: t.chain,
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    ageMinutes: Math.round(t.ageMinutes),
    priceUsd: t.price,
    marketCapUsd: Math.round(t.marketCap),
    fdvUsd: Math.round(t.fdv),
    liquidityUsd: Math.round(t.liquidity),
    volume24hUsd: Math.round(t.volume24h),
    txns24h: t.txns24h,
    buys24h: t.buys24h,
    sells24h: t.sells24h,
    changePct: t.change,
    holders: t.holders,
    top10HoldersPct: t.top10Pct,
    security: t.security,
    launchpad: t.launchpad ?? null,
    dataUpdatedAt: t.updatedAt ?? null,
  };
}
