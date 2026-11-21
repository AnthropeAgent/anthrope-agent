/**
 * Bagian murni search: deteksi alamat dan ranking akhir (ARCHITECTURE §4.11).
 * Urutan: alamat persis > simbol persis > awalan simbol > nama persis/awalan > mengandung > fuzzy,
 * lalu likuiditas, lalu volume 24h. Likuiditas di depan supaya token tiruan ("USDC" palsu) turun.
 */
import type { Token } from "@ot/types";

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Jenis alamat yang dikenali dari teks query, atau null bila bukan alamat. */
export function addressKind(q: string): "evm" | "solana" | null {
  const s = q.trim();
  if (EVM_RE.test(s)) return "evm";
  if (SOLANA_RE.test(s)) return "solana";
  return null;
}

/** Rapikan query: buang spasi berlebih dan "$" di depan simbol ($BONK → bonk). */
export function normalizeQuery(q: string): string {
  return q.trim().replace(/^\$+/, "").replace(/\s+/g, " ").toLowerCase();
}

export function matchTier(q: string, t: Pick<Token, "symbol" | "name" | "address">): number {
  const s = normalizeQuery(q);
  const sym = t.symbol.toLowerCase();
  const name = t.name.toLowerCase();
  if (t.address.toLowerCase() === s) return 0;
  if (sym === s) return 1;
  if (sym.startsWith(s)) return 2;
  if (name === s || name.startsWith(s)) return 3;
  if (sym.includes(s) || name.includes(s)) return 4;
  return 5; // cocok fuzzy (typo) dari mesin search
}

export function rankTokens<T extends Pick<Token, "symbol" | "name" | "address" | "liquidity" | "volume24h">>(q: string, tokens: T[]): T[] {
  return tokens
    .map((t) => ({ t, tier: matchTier(q, t) }))
    .sort((a, b) => a.tier - b.tier || b.t.liquidity - a.t.liquidity || b.t.volume24h - a.t.volume24h)
    .map((x) => x.t);
}
