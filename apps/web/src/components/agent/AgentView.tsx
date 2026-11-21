"use client";

import Link from "next/link";
import { useMemo } from "react";
import { TokenAvatar } from "@/components/TokenAvatar";
import { ROUTES } from "@/config/brand";
import type { Token, TraderRow } from "@/lib/data/types";
import { fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import { AnalystPanel } from "./AnalystPanel";
import { tokenBrief } from "@/lib/agentContext";

export function AgentView({ trending, traders }: { trending: Token[]; traders: TraderRow[] }) {
  const context = useMemo(
    () => ({
      page: "market overview",
      now: new Date().toISOString(),
      trendingTokens: trending.map(tokenBrief),
      topTraders: traders.map((r) => ({ wallet: r.address, pnlUsd: Math.round(r.pnlUsd), roiPct: Math.round(r.roiPct), winRatePct: Math.round(r.winRate), volumeUsd: Math.round(r.volumeUsd), trades: r.trades })),
      notes: "Top traders PnL is computed only from trades observed by this platform, not full wallet history.",
    }),
    [trending, traders],
  );
  return (
    <div className="scrollbar-thin flex h-full flex-col gap-3 overflow-y-auto p-3 lg:flex-row lg:overflow-hidden">
      <div className="h-[560px] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
        <AnalystPanel
          title="AI Agent · market analyst"
          context={context}
          suggestions={[
            "Token trending mana yang likuiditasnya paling sehat dibanding market cap-nya?",
            "Ringkas kondisi pasar dari data trending sekarang.",
            "Token mana yang punya tanda bahaya dari sisi security atau konsentrasi holder?",
            "Apa yang dilakukan top trader minggu ini?",
          ]}
        />
      </div>
      <aside className="scrollbar-thin shrink-0 rounded-xl border border-line lg:w-[320px] lg:overflow-y-auto">
        <div className="border-b border-line px-3 py-2 text-xs text-muted">Data yang dibaca agent ({trending.length} token trending)</div>
        {trending.map((t) => (
          <Link key={`${t.chain}:${t.address}`} href={ROUTES.token(t.chain, t.address)} className="num flex items-center gap-2 border-b border-line/50 px-3 py-2 text-xs hover:bg-panel-2">
            <TokenAvatar symbol={t.symbol} color={t.logoColor} logoUrl={t.logoUrl} chain={t.chain} size={20} />
            <span className="w-16 truncate text-fg">{t.symbol}</span>
            <span className="text-soft">{fmtPrice(t.price)}</span>
            <span className="ml-auto text-muted">{fmtUsd(t.liquidity)}</span>
            <span className={`w-14 text-right ${(t.change["24h"] ?? 0) >= 0 ? "text-up" : "text-down"}`}>{fmtPct(t.change["24h"])}</span>
          </Link>
        ))}
      </aside>
    </div>
  );
}
