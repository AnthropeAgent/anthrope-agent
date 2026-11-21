"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeftRight, ChevronsUpDown, Copy, Globe, Search, Send, ShieldCheck } from "lucide-react";
import { WatchStar } from "@/components/account/WatchStar";
import { TokenAvatar } from "@/components/TokenAvatar";
import { ROUTES } from "@/config/brand";
import type { Timeframe, Token } from "@/lib/data/types";
import { useLiveTokens } from "@/lib/data/useLiveTokens";
import { fmtAge, fmtNum, fmtPct, fmtPrice, fmtUsd, pctClass, shortAddr } from "@/lib/format";

export type ColKey = "mc" | "price" | "vol" | "txns" | "liq" | "5m" | "1h" | "4h" | "24h" | "holders" | "top10";

export const ALL_COLS: { k: ColKey; label: string; w: string }[] = [
  { k: "mc", label: "MC", w: "w-24" },
  { k: "price", label: "Price", w: "w-28" },
  { k: "vol", label: "Vol", w: "w-24" },
  { k: "txns", label: "Txns", w: "w-20" },
  { k: "liq", label: "Liquidity", w: "w-24" },
  { k: "5m", label: "5m %", w: "w-20" },
  { k: "1h", label: "1h %", w: "w-20" },
  { k: "4h", label: "4h %", w: "w-20" },
  { k: "24h", label: "24h %", w: "w-20" },
  { k: "holders", label: "Holders", w: "w-20" },
  { k: "top10", label: "Top 10", w: "w-20" },
];

const sortVal = (t: Token, k: ColKey): number => {
  switch (k) {
    case "mc": return t.marketCap;
    case "price": return t.price;
    case "vol": return t.volume24h;
    case "txns": return t.txns24h;
    case "liq": return t.liquidity;
    case "holders": return t.holders ?? -1;
    case "top10": return t.top10Pct ?? -1;
    default: return t.change[k as Timeframe] ?? -Infinity;
  }
};

export interface Filters {
  minMc?: number;
  minLiq?: number;
  minVol?: number;
  verifiedOnly?: boolean;
}

export function TokenTable({
  initial,
  timeframe,
  visible,
  filters,
}: {
  initial: Token[];
  timeframe: Timeframe;
  visible: ColKey[];
  filters: Filters;
}) {
  const router = useRouter();
  const { tokens, flash } = useLiveTokens(initial);
  const [sort, setSort] = useState<{ k: ColKey; dir: 1 | -1 } | null>(null);

  const rows = useMemo(() => {
    let r = tokens.filter(
      (t) =>
        t.marketCap >= (filters.minMc ?? 0) &&
        t.liquidity >= (filters.minLiq ?? 0) &&
        t.volume24h >= (filters.minVol ?? 0) &&
        (!filters.verifiedOnly || t.verified),
    );
    if (sort) r = [...r].sort((a, b) => (sortVal(a, sort.k) - sortVal(b, sort.k)) * sort.dir);
    return r;
  }, [tokens, sort, filters]);

  const cols = ALL_COLS.filter((c) => visible.includes(c.k));
  const volLabel = (k: ColKey, l: string) => (k === "vol" || k === "txns" ? `${timeframe} ${l}` : l);

  return (
    <div className="scrollbar-thin h-full overflow-auto">
      <table className="num w-full min-w-[1100px] border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-10 bg-bg text-xs text-muted">
          <tr>
            <th className="w-10 border-b border-line" />
            <th className="w-10 border-b border-line py-2.5 text-left font-normal">#</th>
            <th className="border-b border-line py-2.5 text-left font-normal">Token</th>
            {cols.map((c) => (
              <th key={c.k} className={`${c.w} border-b border-line py-2.5 pr-3 text-right font-normal`}>
                <button
                  className="inline-flex items-center gap-1 hover:text-fg"
                  onClick={() => setSort((s) => (s?.k === c.k ? (s.dir === -1 ? { k: c.k, dir: 1 } : null) : { k: c.k, dir: -1 }))}
                >
                  {volLabel(c.k, c.label)}
                  <ChevronsUpDown size={11} className={sort?.k === c.k ? "text-primary" : ""} />
                </button>
              </th>
            ))}
            <th className="w-14 border-b border-line" />
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => {
            const href = ROUTES.token(t.chain, t.address);
            const f = flash[t.address];
            return (
              <tr
                key={t.chain + t.address}
                onClick={() => router.push(href)}
                className={`cursor-pointer hover:bg-panel-2 ${f === "up" ? "animate-flash-up" : f === "down" ? "animate-flash-down" : ""}`}
              >
                <td className="border-b border-line/60 pl-3">
                  <WatchStar chain={t.chain} address={t.address} />
                </td>
                <td className="border-b border-line/60 text-muted">{i + 1}</td>
                <td className="border-b border-line/60 py-2">
                  <div className="flex items-center gap-2.5">
                    <TokenAvatar symbol={t.symbol} color={t.logoColor} logoUrl={t.logoUrl} chain={t.chain} verified={t.verified} size={30} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Link href={href} onClick={(e) => e.stopPropagation()} className="font-bold text-fg">
                          {t.symbol}
                        </Link>
                        <span className="max-w-36 truncate text-xs text-muted">{t.name}</span>
                        {t.security.mintRevoked && t.security.freezeRevoked && <ShieldCheck size={12} className="text-up" />}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted">
                        <span className="font-medium text-up">{fmtAge(t.ageMinutes)}</span>
                        <span>{shortAddr(t.address)}</span>
                        <button
                          aria-label="Copy address"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard?.writeText(t.address);
                          }}
                          className="hover:text-fg"
                        >
                          <Copy size={11} />
                        </button>
                        {t.socials.website && <Globe size={11} />}
                        {t.socials.telegram && <Send size={11} />}
                        <Search size={11} />
                      </div>
                    </div>
                  </div>
                </td>
                {cols.map((c) => (
                  <td key={c.k} className="border-b border-line/60 pr-3 text-right">
                    <Cell t={t} k={c.k} />
                  </td>
                ))}
                <td className="border-b border-line/60 pr-3 text-right">
                  <button aria-label="Quick swap" onClick={(e) => e.stopPropagation()} className="grid h-7 w-9 place-items-center rounded-md bg-panel-3 text-soft hover:text-primary">
                    <ArrowLeftRight size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols.length + 4} className="py-20 text-center text-muted">
                Tidak ada token yang cocok dengan filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ t, k }: { t: Token; k: ColKey }) {
  switch (k) {
    case "mc":
      return <span className={t.marketCap < 1e5 ? "text-warn" : "text-mcap"}>{fmtUsd(t.marketCap)}</span>;
    case "price":
      return <span className="text-fg">{fmtPrice(t.price)}</span>;
    case "vol":
      return <span className="text-fg">{fmtUsd(t.volume24h)}</span>;
    case "txns":
      return <span className="text-fg">{fmtNum(t.txns24h)}</span>;
    case "liq":
      return <span className="text-fg">{fmtUsd(t.liquidity)}</span>;
    case "holders":
      return <span className="text-fg">{t.holders == null ? "_" : fmtNum(t.holders)}</span>;
    case "top10":
      return <span className={t.top10Pct != null && t.top10Pct > 40 ? "text-down" : "text-fg"}>{t.top10Pct == null ? "_" : `${t.top10Pct.toFixed(2)}%`}</span>;
    default: {
      const v = t.change[k as Timeframe];
      return <span className={pctClass(v)}>{fmtPct(v)}</span>;
    }
  }
}
