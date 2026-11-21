import Link from "next/link";
import { useId } from "react";
import { BRAND } from "@/config/brand";

/**
 * Lambang Anthrope Agent: medali bergaya 3D. Cincin emas dengan bevel, muka medali gelap, dan huruf "A"
 * yang dibentuk dari lengkung runcing bertiang + ambang (crossbar) + alas kuil, dengan batu kunci di puncak.
 * Digambar sendiri dengan SVG. Versi statis yang sama ada di app/icon.svg (favicon).
 */
export function LogoMark({ size = 30 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  const g = (n: string) => `url(#${id}${n})`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id={`${id}rim`} x1="0.15" y1="0.05" x2="0.85" y2="0.95">
          <stop offset="0" stopColor="#fbf0d6" />
          <stop offset="0.35" stopColor="#d9b56f" />
          <stop offset="0.7" stopColor="#a07a3e" />
          <stop offset="1" stopColor="#5e4421" />
        </linearGradient>
        <linearGradient id={`${id}rimIn`} x1="0.85" y1="0.95" x2="0.15" y2="0.05">
          <stop offset="0" stopColor="#f3e2b8" />
          <stop offset="0.5" stopColor="#b89050" />
          <stop offset="1" stopColor="#6b4e26" />
        </linearGradient>
        <radialGradient id={`${id}face`} cx="0.4" cy="0.32" r="0.8">
          <stop offset="0" stopColor="#3a2c1f" />
          <stop offset="0.6" stopColor="#1d1610" />
          <stop offset="1" stopColor="#0e0a07" />
        </radialGradient>
        <linearGradient id={`${id}mark`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6e3" />
          <stop offset="0.55" stopColor="#efe4d0" />
          <stop offset="1" stopColor="#d2b27a" />
        </linearGradient>
        <radialGradient id={`${id}gloss`} cx="0.35" cy="0.15" r="0.6">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* cincin luar (bevel) */}
      <circle cx="32" cy="32" r="31" fill={g("rim")} />
      <circle cx="32" cy="32" r="27.2" fill={g("rimIn")} />
      {/* muka medali */}
      <circle cx="32" cy="32" r="25.4" fill={g("face")} />
      <circle cx="32" cy="32" r="22.6" fill="none" stroke="#d9b56f" strokeOpacity="0.35" strokeWidth="0.7" strokeDasharray="1.2 1.6" />

      {/* bayangan huruf (memberi kedalaman) */}
      <g transform="translate(0.9 1.3)" stroke="#000" strokeOpacity="0.55" fill="none" strokeLinecap="square">
        <path d="M22 46.5V30.5C22 23 26.2 18.4 32 15.6C37.8 18.4 42 23 42 30.5V46.5" strokeWidth="4.6" />
        <path d="M22 34.4H42" strokeWidth="3" />
        <path d="M17.5 48.6H46.5" strokeWidth="2.6" />
      </g>
      {/* huruf A: lengkung runcing bertiang */}
      <g stroke={g("mark")} fill="none" strokeLinecap="square">
        <path d="M22 46.5V30.5C22 23 26.2 18.4 32 15.6C37.8 18.4 42 23 42 30.5V46.5" strokeWidth="4.6" />
        <path d="M22 34.4H42" strokeWidth="3" />
        <path d="M17.5 48.6H46.5" strokeWidth="2.6" />
      </g>
      {/* kepala tiang & batu kunci */}
      <g fill={g("mark")}>
        <rect x="18.8" y="44.2" width="6.4" height="1.6" />
        <rect x="38.8" y="44.2" width="6.4" height="1.6" />
        <path d="M32 9.6 34.3 12.9 32 16.2 29.7 12.9Z" />
      </g>

      {/* kilau kaca di atas */}
      <circle cx="32" cy="32" r="31" fill={g("gloss")} />
    </svg>
  );
}

export function Logo({ href = "/", sub, className = "" }: { href?: string; sub?: string; className?: string }) {
  return (
    <Link href={href} className={`flex items-center gap-2.5 text-marble ${className}`} aria-label={`${BRAND.name} home`}>
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="font-roman text-[15px] font-semibold tracking-[0.12em] whitespace-nowrap text-fg uppercase">{BRAND.name}</span>
        {sub && <span className="mt-1 text-[8px] tracking-[0.22em] text-dim uppercase">{sub}</span>}
      </span>
    </Link>
  );
}
