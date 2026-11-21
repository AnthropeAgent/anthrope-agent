/**
 * Evaluasi alert (langkah 11), murni supaya bisa dites. Worker memanggilnya untuk tiap rule aktif.
 */
import type { AlertKind, Token } from "@ot/types";

export interface RuleLike {
  kind: AlertKind;
  threshold: number;
  cooldownSec: number;
  lastFiredAt: number | null;
}

export interface Fired {
  value: number;
  message: string;
}

const fmt = (v: number) => (v >= 1 ? v.toLocaleString("en-US", { maximumFractionDigits: 4 }) : v.toPrecision(4));

/** null bila tidak memicu (kondisi belum terpenuhi, data tidak ada/basi, atau masih cooldown). */
export function evaluate(rule: RuleLike, token: Token | null, now: number, maxAgeMs = 5 * 60_000): Fired | null {
  if (!token || token.stale) return null;
  if (token.updatedAt && now - Date.parse(token.updatedAt) > maxAgeMs) return null;
  if (rule.lastFiredAt != null && now - rule.lastFiredAt < rule.cooldownSec * 1000) return null;
  const sym = token.symbol;
  switch (rule.kind) {
    case "price_above":
      return token.price >= rule.threshold ? { value: token.price, message: `${sym} naik ke $${fmt(token.price)} (≥ $${fmt(rule.threshold)})` } : null;
    case "price_below":
      return token.price <= rule.threshold ? { value: token.price, message: `${sym} turun ke $${fmt(token.price)} (≤ $${fmt(rule.threshold)})` } : null;
    case "pct_change": {
      const c = token.change["1h"];
      if (c == null || Math.abs(c) < rule.threshold) return null;
      return { value: c, message: `${sym} ${c >= 0 ? "naik" : "turun"} ${Math.abs(c).toFixed(1)}% dalam 1 jam (ambang ${rule.threshold}%)` };
    }
  }
}
