"use client";

import { useState } from "react";
import { chainById, chainIcon } from "@/config/chains";

export function TokenAvatar({
  symbol,
  color,
  logoUrl,
  chain,
  size = 32,
  verified,
}: {
  symbol: string;
  color: string;
  /** Logo dari provider (pihak ketiga). Jika gagal dimuat, kembali ke avatar warna. */
  logoUrl?: string | null;
  chain?: string;
  size?: number;
  verified?: boolean;
}) {
  const c = chain ? chainById(chain) : undefined;
  const [failed, setFailed] = useState<string | null>(null);
  const showLogo = !!logoUrl && failed !== logoUrl;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className="grid h-full w-full place-items-center overflow-hidden rounded-full font-bold text-black/80"
        style={{ background: `radial-gradient(circle at 30% 30%, ${color}, color-mix(in oklab, ${color} 55%, black))`, fontSize: size * 0.32 }}
      >
        {showLogo ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo dari banyak domain provider; dipindah ke CDN sendiri nanti (ARCHITECTURE §4.4)
          <img
            src={logoUrl}
            alt=""
            width={size}
            height={size}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
            onError={() => setFailed(logoUrl)}
          />
        ) : (
          symbol.slice(0, 2).toUpperCase()
        )}
      </span>
      {c && (
        <span className="absolute -top-0.5 -right-0.5 overflow-hidden rounded-full border border-bg" style={{ width: size * 0.4, height: size * 0.4, background: c.color }} title={c.name}>
          <ChainImg id={c.id} />
        </span>
      )}
      {verified && (
        <span className="absolute -bottom-0.5 -left-0.5 grid place-items-center rounded-full bg-up text-[8px] text-black" style={{ width: size * 0.36, height: size * 0.36 }}>
          ✓
        </span>
      )}
    </span>
  );
}

/** Gambar ikon chain; disembunyikan bila gagal dimuat sehingga latar warna/huruf di belakangnya terlihat. */
function ChainImg({ id }: { id: string }) {
  const src = chainIcon(id);
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- ikon kecil dari CDN publik
    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
  );
}

export function ChainDot({ id, size = 22, active }: { id: string; size?: number; active?: boolean }) {
  const c = chainById(id);
  if (!c) return null;
  return (
    <span
      className={`relative grid place-items-center overflow-hidden rounded-full font-bold text-black/80 ${active ? "ring-2 ring-primary ring-offset-2 ring-offset-bg" : ""}`}
      style={{ width: size, height: size, background: c.color, fontSize: size * 0.3 }}
      title={c.name}
    >
      {c.short.slice(0, 2)}
      <ChainImg id={id} />
    </span>
  );
}

/** Ikon "semua chain": empat chain utama dalam satu lingkaran. */
export function AllChainsIcon({ size = 24, active }: { size?: number; active?: boolean }) {
  const ids = ["solana", "ethereum", "base", "bsc"];
  return (
    <span
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-full bg-line p-px ${active ? "ring-2 ring-primary ring-offset-2 ring-offset-bg" : ""}`}
      style={{ width: size, height: size }}
      title="All chains"
    >
      {ids.map((id) => (
        <span key={id} className="relative overflow-hidden" style={{ background: chainById(id)?.color }}>
          <ChainImg id={id} />
        </span>
      ))}
    </span>
  );
}
