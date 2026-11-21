import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ROUTES } from "@/config/brand";
import type { PerpMarket } from "@/lib/data/types";
import { fmtPrice } from "@/lib/format";
import type { SiteToken } from "@/lib/data/api";
import { ContractAddress } from "./ContractAddress";

/**
 * Hero: "The School of Athens" karya Raphael (1509–1511, domain publik; sumber Wikimedia Commons),
 * public/hero/athens.jpg dipotong 16:9. Judul di area langit-langit lengkung yang digelapkan,
 * para filsuf tetap terlihat di bawahnya.
 * Ticker memakai harga perps asli (Hyperliquid).
 */
export function RomanHero({ ticker, token }: { ticker: PerpMarket | null; token?: SiteToken | null }) {
  return (
    <section className="relative isolate overflow-hidden bg-bg">
      <Image src="/hero/athens.jpg" alt="" fill priority sizes="100vw" quality={85} className="-z-20 object-cover object-[50%_62%]" />
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background: [
            "linear-gradient(to bottom, rgba(15,12,9,0.88) 0%, rgba(15,12,9,0.7) 30%, rgba(15,12,9,0.25) 58%, rgba(15,12,9,0.1) 72%)",
            "linear-gradient(to top, var(--color-bg) 0%, rgba(15,12,9,0.55) 12%, rgba(15,12,9,0) 30%)",
            "radial-gradient(ellipse 80% 70% at 50% 40%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.45) 100%)",
          ].join(","),
        }}
      />

      <div className="relative mx-auto flex min-h-[720px] max-w-3xl flex-col items-center px-4 pt-24 pb-72 text-center md:min-h-[880px] md:pt-28 md:pb-96">
        {ticker && (
          <Link
            href={ROUTES.perps}
            className="num inline-flex items-center gap-2 border border-cream/30 bg-black/30 px-3 py-1 font-roman text-[11px] tracking-[0.14em] text-cream uppercase backdrop-blur-sm hover:border-cream/60"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-up shadow-[0_0_8px] shadow-up" />
            {ticker.coin}-PERP · {fmtPrice(ticker.markPx)}
            {ticker.change24hPct != null && (
              <span className={ticker.change24hPct >= 0 ? "text-up" : "text-down"}>
                {ticker.change24hPct >= 0 ? "+" : ""}
                {ticker.change24hPct.toFixed(2)}% 24H
              </span>
            )}
          </Link>
        )}
        <h1 className="mt-6 font-serif text-5xl leading-[1.04] font-normal text-cream [text-shadow:0_2px_24px_rgba(0,0,0,0.55)] md:text-[72px]">
          The forum of <span className="italic text-gold">onchain</span>
          <br />
          markets
        </h1>
        <p className="mt-5 max-w-lg text-sm leading-relaxed text-cream/85 [text-shadow:0_1px_12px_rgba(0,0,0,0.7)] md:text-base">
          Consult the AI analyst before you trade. It reads live prices, liquidity, holders, security scans and trader flow, then explains what it sees.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href={ROUTES.agent} className="inline-flex items-center gap-1.5 bg-cream px-6 py-3 font-roman text-xs font-semibold tracking-[0.16em] text-ink uppercase hover:bg-white">
            Consult the agent <ArrowUpRight size={14} />
          </Link>
          <Link href={ROUTES.terminal} className="border border-cream/45 bg-black/20 px-6 py-3 font-roman text-xs tracking-[0.16em] text-cream uppercase backdrop-blur-sm hover:border-cream/80">
            Enter the terminal
          </Link>
        </div>
        {token && <ContractAddress token={token} />}
      </div>
    </section>
  );
}
