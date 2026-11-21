"use client";

/**
 * Pembaruan token di layar.
 * - Data asli (token punya `updatedAt`): subscribe `/ws` channel `price:{chain}:{address}` untuk tiap
 *   token yang tampil; flash dari perubahan harga sungguhan. Server component tetap di-refresh tiap
 *   `REAL_REFRESH_MS` untuk susunan daftar (token masuk/keluar trending), dan setelah reconnect.
 * - Data mock: random walk agar UI terlihat hidup. Tidak pernah dipakai pada data asli.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Token } from "./types";
import { useChannels } from "./ws";

export type Flash = Record<string, "up" | "down">;

const REAL_REFRESH_MS = 60_000;
const FLASH_MS = 1_000;
/** Field yang dikirim channel price (lihat PriceUpdate di @ot/bridge). */
type PriceUpdate = Partial<Pick<Token, "price" | "priceNative" | "marketCap" | "fdv" | "liquidity" | "change" | "volume24h" | "txns24h" | "buys24h" | "sells24h" | "traders24h" | "updatedAt">>;

export function useLiveTokens(initial: Token[], intervalMs = 1500) {
  const real = initial.some((t) => t.updatedAt);
  const [tokens, setTokens] = useState(initial);
  const [flash, setFlash] = useState<Flash>({});
  const router = useRouter();

  // Reset saat daftar berubah, atau (data asli) saat snapshot baru datang dari server.
  const key = initial.map((t) => t.chain + t.address + (real ? (t.updatedAt ?? "") : "")).join("|");
  const keyRef = useRef(key);
  const prevRef = useRef(initial);

  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    if (real) {
      const before = new Map(prevRef.current.map((t) => [t.chain + t.address, t.price]));
      const f: Flash = {};
      for (const t of initial) {
        const p = before.get(t.chain + t.address);
        if (p != null && p !== t.price) f[t.address] = t.price > p ? "up" : "down";
      }
      setFlash(f);
    }
    prevRef.current = initial;
    setTokens(initial);
  }, [key, initial, real]);

  // Data asli: harga live dari WebSocket.
  const priceOf = useRef(new Map<string, number>());
  useEffect(() => {
    priceOf.current = new Map(tokens.map((t) => [`${t.chain}:${t.address}`, t.price]));
  }, [tokens]);
  const channels = real ? initial.map((t) => `price:${t.chain}:${t.address}`) : [];
  useChannels(
    channels,
    (ch, data) => {
      const key = ch.slice("price:".length);
      const u = data as PriceUpdate;
      const before = priceOf.current.get(key);
      setTokens((prev) => prev.map((t) => (`${t.chain}:${t.address}` === key ? { ...t, ...u, stale: false } : t)));
      if (before == null || u.price == null || u.price === before) return;
      const addr = key.slice(key.indexOf(":") + 1);
      const dir = u.price > before ? "up" : "down";
      setFlash((f) => ({ ...f, [addr]: dir }));
      setTimeout(() => setFlash((f) => (f[addr] === dir ? Object.fromEntries(Object.entries(f).filter(([k]) => k !== addr)) : f)), FLASH_MS);
    },
    () => router.refresh(),
    real,
  );

  // Data asli: susunan daftar diperbarui dengan render ulang server, hanya saat tab terlihat.
  useEffect(() => {
    if (!real) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REAL_REFRESH_MS);
    return () => clearInterval(id);
  }, [real, router]);

  // Data mock: random walk.
  useEffect(() => {
    if (real) return;
    const id = setInterval(() => {
      const f: Flash = {};
      setTokens((prev) =>
        prev.map((t) => {
          if (Math.random() > 0.25) return t;
          const d = (Math.random() - 0.5) * (t.isRwa ? 0.004 : 0.03);
          f[t.address] = d >= 0 ? "up" : "down";
          const price = t.price * (1 + d);
          const extraVol = Math.random() * t.volume24h * 0.0005;
          return {
            ...t,
            price,
            marketCap: t.marketCap * (1 + d),
            volume24h: t.volume24h + extraVol,
            txns24h: t.txns24h + Math.ceil(Math.random() * 5),
            change: {
              ...t.change,
              "5m": (t.change["5m"] ?? 0) + d * 100,
              "1h": (t.change["1h"] ?? 0) + d * 100,
              "4h": (t.change["4h"] ?? 0) + d * 100,
              "24h": (t.change["24h"] ?? 0) + d * 100,
            },
          };
        }),
      );
      setFlash(f);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, real]);

  return { tokens, flash };
}
