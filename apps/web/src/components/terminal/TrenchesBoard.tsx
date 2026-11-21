"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Zap } from "lucide-react";
import { ChainDot, TokenAvatar } from "@/components/TokenAvatar";
import { CHAINS } from "@/config/chains";
import { ROUTES } from "@/config/brand";
import type { Token, TrenchStage, TrenchToken } from "@/lib/data/types";
import { useLiveTokens } from "@/lib/data/useLiveTokens";
import { fmtAge, fmtNum, fmtUsd, shortAddr } from "@/lib/format";

const COLS: { k: TrenchStage; label: string }[] = [
  { k: "new", label: "New Pairs" },
  { k: "final", label: "Final Stretch" },
  { k: "migrated", label: "Migrated" },
];

export function TrenchesBoard({ chain, items }: { chain: string; items: TrenchToken[] }) {
  const { tokens, flash } = useLiveTokens(items as Token[], 1200);
  const live = tokens as TrenchToken[];
  const pads = useMemo(() => [...new Set(items.map((t) => t.launchpad).filter((p): p is string => !!p))], [items]);
  const [pad, setPad] = useState<string | "all">("all");
  const [amount, setAmount] = useState("0.5");
  const [mobileCol, setMobileCol] = useState<TrenchStage>("new");
  const router = useRouter();
  // Worker memperbarui Trenches tiap ±40 dtk; muat ulang data server secara berkala.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(id);
  }, [router]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-3 py-2">
        <span className="text-lg font-bold text-fg">Trenches</span>
        <div className="flex items-center gap-1.5">
          {CHAINS.filter((c) => c.trenches).map((c) => (
            <Link key={c.id} href={ROUTES.trenches(c.id)} className={chain === c.id ? "" : "opacity-50 hover:opacity-100"}>
              <ChainDot id={c.id} size={22} active={chain === c.id} />
            </Link>
          ))}
        </div>
        <div className="flex gap-1 text-xs">
          {["all", ...pads].map((p) => (
            <button key={p} onClick={() => setPad(p)} className={`rounded-md px-2.5 py-1 ${pad === p ? "bg-panel-3 text-fg" : "text-muted hover:text-fg"}`}>
              {p === "all" ? "All launchpads" : p}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-muted">
          <Zap size={12} className="text-primary" /> Quick buy
          <input value={amount} onChange={(e) => setAmount(e.target.value)} className="num w-12 bg-transparent text-right text-fg outline-none" />
          {CHAINS.find((c) => c.id === chain)?.native}
        </label>
      </div>
      <div className="flex gap-1 border-b border-line p-1 md:hidden">
        {COLS.map((c) => (
          <button key={c.k} onClick={() => setMobileCol(c.k)} className={`flex-1 rounded py-1.5 text-xs ${mobileCol === c.k ? "bg-panel-3 text-fg" : "text-muted"}`}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 md:grid-cols-3">
        {COLS.map((col) => (
          <section key={col.k} className={`min-h-0 flex-col border-line md:flex md:border-r ${mobileCol === col.k ? "flex" : "hidden"}`}>
            <div className="hidden shrink-0 items-center justify-between px-3 py-2 text-sm font-medium text-fg md:flex">
              {col.label}
              <span className="text-xs text-muted">{live.filter((t) => t.stage === col.k).length}</span>
            </div>
            <div className="scrollbar-thin min-h-0 flex-1 space-y-1 overflow-auto px-2 pb-2">
              {!live.some((t) => t.stage === col.k) && <div className="px-2 py-6 text-center text-xs text-muted">{items.length ? "Belum ada token di tahap ini." : "Worker sedang mengumpulkan token pump.fun… muat ulang sebentar lagi."}</div>}
              {live
                .filter((t) => t.stage === col.k && (pad === "all" || t.launchpad === pad))
                .map((t) => (
                  <Link
                    key={t.address}
                    href={ROUTES.token(t.chain, t.address)}
                    className={`flex gap-2.5 rounded-lg border border-line bg-panel p-2.5 hover:border-line-2 ${flash[t.address] === "up" ? "animate-flash-up" : flash[t.address] === "down" ? "animate-flash-down" : ""}`}
                  >
                    <TokenAvatar symbol={t.symbol} color={t.logoColor} logoUrl={t.logoUrl} chain={t.chain} size={44} />
                    <div className="num min-w-0 flex-1 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-bold text-fg">{t.symbol}</span>
                        <span className="truncate text-muted">{t.name}</span>
                      </div>
                      <div className="mt-0.5 flex gap-2 text-muted">
                        <span className="text-up">{fmtAge(t.ageMinutes)}</span>
                        <span>{shortAddr(t.address)}</span>
                        <span>{t.launchpad}</span>
                      </div>
                      <div className="mt-1.5 flex gap-3">
                        <span>
                          <span className="text-muted">MC </span>
                          <span className="text-mcap">{fmtUsd(t.marketCap)}</span>
                        </span>
                        <span>
                          <span className="text-muted">V </span>
                          <span className="text-fg">{fmtUsd(t.volume24h)}</span>
                        </span>
                        <span>
                          <span className="text-muted">H </span>
                          <span className="text-fg">{fmtNum(t.holders ?? 0)}</span>
                        </span>
                      </div>
                      {col.k !== "migrated" && (
                        <div className="mt-1.5 h-1 overflow-hidden rounded bg-line">
                          <div className="h-full bg-gradient-to-r from-primary to-up" style={{ width: `${t.bondingPct}%` }} />
                        </div>
                      )}
                    </div>
                    <span
                      title="Buka token untuk membeli lewat panel Buy (ditandatangani di wallet kamu)"
                      className="flex h-7 shrink-0 items-center gap-1 self-center rounded-md bg-primary/15 px-2 text-xs font-medium text-primary hover:bg-primary hover:text-ink"
                    >
                      <Zap size={12} />
                      {amount}
                    </span>
                  </Link>
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
