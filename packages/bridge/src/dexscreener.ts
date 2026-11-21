/**
 * Adapter DexScreener (API publik gratis, tanpa key). Dipakai untuk METRIK per token:
 * `/tokens/v1/{chain}/{addr1,...}` (maks 30 alamat per panggilan) mengembalikan pair-pair token itu.
 * Syarat pakai: tidak boleh dijual ulang / diekspos sebagai API ke pihak ketiga (lihat ARCHITECTURE §3).
 */
import { BRIDGE_CHAINS, normAddress, type BridgeChain } from "./chains";
import { fetchJson, RateLimiter } from "./http";
import { cleanText, cleanUrl, num } from "./sanitize";

const BASE = "https://api.dexscreener.com";
const limiter = new RateLimiter(1_200); // ≤ 50 panggilan/menit, jauh di bawah limit publik
export const DS_BATCH = 30;

export interface DsPair {
  chain: BridgeChain;
  pairAddress: string;
  dex: string;
  base: { address: string; symbol: string; name: string };
  quoteSymbol: string;
  priceUsd: number | null;
  priceNative: number | null;
  liquidityUsd: number | null;
  fdv: number | null;
  marketCap: number | null;
  volume24h: number | null;
  change: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  buys24h: number | null;
  sells24h: number | null;
  createdAt: number | null; // ms
  imageUrl?: string;
  socials: { website?: string; x?: string; telegram?: string };
}

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

/** Pure: ubah satu pair mentah → DsPair. Diekspor untuk tes. */
export function parsePair(chain: BridgeChain, raw: unknown): DsPair | null {
  const p = o(raw);
  const base = o(p.baseToken);
  const address = cleanText(base.address, 100);
  if (!address) return null;
  const info = o(p.info);
  const websites = Array.isArray(info.websites) ? info.websites.map(o) : [];
  const socials = Array.isArray(info.socials) ? info.socials.map(o) : [];
  const social = (type: string) => cleanUrl(socials.find((s) => s.type === type)?.url);
  const txns = o(o(p.txns).h24);
  const change = o(p.priceChange);
  return {
    chain,
    pairAddress: cleanText(p.pairAddress, 100),
    dex: cleanText(p.dexId, 40),
    base: { address: normAddress(chain, address), symbol: cleanText(base.symbol, 24) || "?", name: cleanText(base.name, 80) || "Unknown" },
    quoteSymbol: cleanText(o(p.quoteToken).symbol, 24),
    priceUsd: num(p.priceUsd),
    priceNative: num(p.priceNative),
    liquidityUsd: num(o(p.liquidity).usd),
    fdv: num(p.fdv),
    marketCap: num(p.marketCap),
    volume24h: num(o(p.volume).h24),
    change: { m5: num(change.m5), h1: num(change.h1), h6: num(change.h6), h24: num(change.h24) },
    buys24h: num(txns.buys),
    sells24h: num(txns.sells),
    createdAt: num(p.pairCreatedAt),
    imageUrl: cleanUrl(info.imageUrl),
    socials: { website: cleanUrl(websites[0]?.url), x: social("twitter"), telegram: social("telegram") },
  };
}

/** Pair untuk ≤30 token sekaligus, dikelompokkan per alamat base token (hanya pair di mana token = base). */
export async function pairsForTokens(chain: BridgeChain, addresses: string[]): Promise<Map<string, DsPair[]>> {
  if (addresses.length > DS_BATCH) throw new Error(`maks ${DS_BATCH} alamat per panggilan`);
  const out = new Map<string, DsPair[]>();
  if (!addresses.length) return out;
  const url = `${BASE}/tokens/v1/${BRIDGE_CHAINS[chain].ds}/${addresses.map(encodeURIComponent).join(",")}`;
  const raw = await fetchJson<unknown[]>(url, { provider: "dexscreener", limiter });
  const wanted = new Set(addresses.map((a) => normAddress(chain, a)));
  for (const r of Array.isArray(raw) ? raw : []) {
    const pair = parsePair(chain, r);
    if (!pair || !wanted.has(pair.base.address)) continue;
    const list = out.get(pair.base.address) ?? [];
    list.push(pair);
    out.set(pair.base.address, list);
  }
  return out;
}
