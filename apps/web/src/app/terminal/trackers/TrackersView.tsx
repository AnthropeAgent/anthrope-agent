"use client";

import Link from "next/link";
import { useState } from "react";
import { TradersTable } from "@/components/terminal/TokenDetail";
import { ROUTES } from "@/config/brand";
import type { TraderRow, Trade } from "@/lib/data/types";
import { fmtNum, fmtPrice, fmtUsd, shortAddr } from "@/lib/format";

const SUBS = ["Top Traders", "Watchlist", "Live Trades", "Monitor"] as const;

export function TrackersView({ traders, live }: { traders: TraderRow[]; live: (Trade & { symbol: string })[] }) {
  const [sub, setSub] = useState<(typeof SUBS)[number]>("Top Traders");
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 px-3 pt-3 pb-2">
        <div className="flex items-center gap-4">
          <Link href={ROUTES.terminal} className="text-lg font-bold text-muted hover:text-fg">
            Discover
          </Link>
          <span className="text-lg font-bold text-fg">Trackers</span>
        </div>
        <div className="flex gap-4 text-sm">
          {SUBS.map((s) => (
            <button key={s} onClick={() => setSub(s)} className={`border-b-2 pb-1 font-medium ${sub === s ? "border-primary text-fg" : "border-transparent text-muted hover:text-fg"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        {sub === "Top Traders" && <TradersTable rows={traders} />}
        {sub === "Live Trades" && (
          <table className="num w-full min-w-[640px] text-xs">
            <thead className="sticky top-0 bg-bg text-muted">
              <tr>
                {["Token", "Type", "Price", "Value", "Amount", "Wallet"].map((h) => (
                  <th key={h} className="px-3 py-2 text-right font-normal first:text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {live.map((x, i) => (
                <tr key={i} className={x.side === "buy" ? "text-up" : "text-down"}>
                  <td className="border-t border-line/60 px-3 py-1.5 text-fg">{x.symbol}</td>
                  <td className="border-t border-line/60 px-3 text-right capitalize">{x.side}</td>
                  <td className="border-t border-line/60 px-3 text-right">{fmtPrice(x.priceUsd)}</td>
                  <td className="border-t border-line/60 px-3 text-right">{fmtUsd(x.valueUsd)}</td>
                  <td className="border-t border-line/60 px-3 text-right">{fmtNum(x.amountToken)}</td>
                  <td className="border-t border-line/60 px-3 text-right text-soft">
                    <Link href={ROUTES.wallet(x.maker)}>{shortAddr(x.maker)}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {(sub === "Watchlist" || sub === "Monitor") && (
          <div className="grid h-60 place-items-center px-4 text-center text-sm text-muted">
            {sub === "Watchlist" ? "Log in untuk menyimpan wallet yang kamu pantau." : "Tambahkan wallet untuk dimonitor secara realtime (Fase 3: WS + alert)."}
            <Link href={ROUTES.login} className="mt-3 rounded-md bg-primary px-4 py-2 font-medium text-ink">
              LOG IN
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
