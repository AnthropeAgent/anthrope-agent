/**
 * Diff untuk stream realtime: worker hanya mem-publish yang benar-benar berubah.
 */
import type { Candle, Trade } from "@ot/types";
import type { PriceUpdate } from "./store";

/** Sidik jari harga tanpa updatedAt (updatedAt selalu berubah tiap siklus). */
export function priceFingerprint(u: PriceUpdate): string {
  const { updatedAt: _ignored, ...rest } = u;
  return JSON.stringify(rest);
}

/**
 * Trade yang belum ada di snapshot sebelumnya (terbaru dulu).
 * Snapshot pertama (prev null) dikirim semua supaya klien yang sedang menunggu langsung terisi.
 */
export function newTrades(prev: Trade[] | null, next: Trade[]): Trade[] {
  if (!prev) return next;
  const seen = new Set(prev.map((t) => t.id));
  return next.filter((t) => !seen.has(t.id));
}

/** Bar yang baru atau berubah, mulai dari bar terakhir snapshot sebelumnya (urut waktu naik). */
export function changedBars(prev: Candle[] | null, next: Candle[]): Candle[] {
  if (!prev?.length) return [];
  const lastTime = prev[prev.length - 1].time;
  const byTime = new Map(prev.map((c) => [c.time, c]));
  return next.filter((c) => {
    if (c.time < lastTime) return false;
    const old = byTime.get(c.time);
    return !old || old.open !== c.open || old.high !== c.high || old.low !== c.low || old.close !== c.close || old.volume !== c.volume;
  });
}
