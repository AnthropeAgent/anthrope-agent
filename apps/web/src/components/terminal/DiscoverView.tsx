"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, Filter, SlidersHorizontal } from "lucide-react";
import { AllChainsIcon, ChainDot } from "@/components/TokenAvatar";
import { CHAINS } from "@/config/chains";
import { ROUTES } from "@/config/brand";
import type { DiscoverTab, Timeframe, Token } from "@/lib/data/types";
import { ALL_COLS, type ColKey, type Filters, TokenTable } from "./TokenTable";
import { savePreferences, useAccount } from "@/lib/auth/account";

const TABS: { k: DiscoverTab; label: string }[] = [
  { k: "top-mc", label: "Top MC" },
  { k: "trending", label: "Trending" },
  { k: "trenches", label: "Trenches" },
  { k: "rwas", label: "RWAs" },
];
const TFS: Timeframe[] = ["5m", "1h", "4h", "24h"];
const DEFAULT_COLS = ALL_COLS.map((c) => c.k);
const COLS_KEY = "terminal.discover.cols";
const validCols = (v: unknown): ColKey[] => (Array.isArray(v) ? DEFAULT_COLS.filter((c) => v.includes(c)) : DEFAULT_COLS);

export function DiscoverView({ tokens, tab, chain, tf }: { tokens: Token[]; tab: DiscoverTab; chain: string; tf: Timeframe }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [cols, setCols] = useState<ColKey[]>(DEFAULT_COLS);
  const [filters, setFilters] = useState<Filters>({});
  const [pop, setPop] = useState<null | "filter" | "display">(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(COLS_KEY);
      if (v) setCols(validCols(JSON.parse(v)));
    } catch {}
  }, []);
  // Login: kolom dari akun (langkah 5) menang atas localStorage.
  const prefCols = useAccount().me?.preferences.discoverColumns;
  useEffect(() => {
    if (prefCols) setCols(validCols(prefCols));
  }, [prefCols]);

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    p.set(k, v);
    router.push(`${pathname}?${p.toString()}`, { scroll: false });
  };

  const toggleCol = (k: ColKey) => {
    const next = cols.includes(k) ? cols.filter((c) => c !== k) : DEFAULT_COLS.filter((c) => c === k || cols.includes(c));
    setCols(next);
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(next));
    } catch {}
    savePreferences({ discoverColumns: next });
  };

  const activeFilters = Object.values(filters).filter(Boolean).length;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 px-3 pt-3 pb-2">
        <div className="flex items-center gap-4">
          <span className="text-lg font-bold text-fg">Discover</span>
          <Link href={ROUTES.trackers} className="text-lg font-bold text-muted hover:text-fg">
            Trackers
          </Link>
          <div className="no-scrollbar ml-auto flex items-center gap-2 overflow-x-auto py-1 pl-1">
            <button aria-label="All chains" onClick={() => setParam("chain", "all")} className={`shrink-0 ${chain === "all" ? "" : "opacity-70 hover:opacity-100"}`}>
              <AllChainsIcon size={24} active={chain === "all"} />
            </button>
            {CHAINS.map((c) => (
              <button key={c.id} onClick={() => setParam("chain", c.id)} className={`shrink-0 ${chain === c.id || chain === "all" ? "" : "opacity-50 hover:opacity-100"}`}>
                <ChainDot id={c.id} size={24} active={chain === c.id} />
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-4 text-sm">
            {TABS.map((t) => (
              <button
                key={t.k}
                onClick={() => setParam("tab", t.k)}
                className={`border-b-2 pb-1 font-medium ${tab === t.k ? "border-primary text-fg" : "border-transparent text-muted hover:text-fg"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab !== "trenches" && (
            <div className="ml-2 flex rounded-md border border-line p-0.5 text-xs">
              {TFS.map((x) => (
                <button key={x} onClick={() => setParam("tf", x)} className={`rounded px-3 py-1 ${tf === x ? "bg-panel-3 text-fg" : "text-muted hover:text-fg"}`}>
                  {x}
                </button>
              ))}
            </div>
          )}
          {tab !== "trenches" && (
            <div className="relative ml-auto flex gap-2">
              <button onClick={() => setPop((p) => (p === "filter" ? null : "filter"))} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-soft hover:text-fg">
                <Filter size={13} /> Filter {activeFilters > 0 && <span className="rounded bg-primary px-1 text-ink">{activeFilters}</span>}
              </button>
              <button onClick={() => setPop((p) => (p === "display" ? null : "display"))} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs text-soft hover:text-fg">
                <SlidersHorizontal size={13} /> Display <ChevronDown size={12} />
              </button>
              {pop === "filter" && (
                <div className="absolute top-full right-0 z-30 mt-1 w-64 space-y-3 rounded-lg border border-line-2 bg-panel p-4 text-xs shadow-2xl">
                  {([
                    ["minMc", "Min market cap ($)"],
                    ["minLiq", "Min liquidity ($)"],
                    ["minVol", "Min volume ($)"],
                  ] as const).map(([k, l]) => (
                    <label key={k} className="block">
                      <span className="text-muted">{l}</span>
                      <input
                        type="number"
                        min={0}
                        value={filters[k] ?? ""}
                        onChange={(e) => setFilters((f) => ({ ...f, [k]: e.target.value ? Number(e.target.value) : undefined }))}
                        className="mt-1 w-full rounded border border-line-2 bg-bg px-2 py-1.5 text-fg outline-none focus:border-primary"
                      />
                    </label>
                  ))}
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={!!filters.verifiedOnly} onChange={(e) => setFilters((f) => ({ ...f, verifiedOnly: e.target.checked }))} />
                    Verified only
                  </label>
                  <div className="flex justify-between pt-1">
                    <button onClick={() => setFilters({})} className="text-muted hover:text-fg">
                      Reset
                    </button>
                    <button onClick={() => setPop(null)} className="rounded bg-primary px-3 py-1 font-medium text-ink">
                      Apply
                    </button>
                  </div>
                </div>
              )}
              {pop === "display" && (
                <div className="absolute top-full right-0 z-30 mt-1 w-52 rounded-lg border border-line-2 bg-panel p-2 text-xs shadow-2xl">
                  <div className="px-2 py-1 text-muted">Columns</div>
                  {ALL_COLS.map((c) => (
                    <label key={c.k} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-panel-3">
                      <input type="checkbox" checked={cols.includes(c.k)} onChange={() => toggleCol(c.k)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {tab === "trenches" ? (
          <TrenchesPromo />
        ) : (
          <TokenTable key={`${tab}-${chain}`} initial={tokens} timeframe={tf} visible={cols} filters={filters} />
        )}
      </div>
    </div>
  );
}

function TrenchesPromo() {
  const avail = CHAINS.filter((c) => c.trenches);
  return (
    <div className="grid h-full items-center gap-10 overflow-auto px-6 py-10 md:grid-cols-2 md:px-12">
      <div>
        <h2 className="text-3xl leading-tight font-black text-fg md:text-4xl">
          EXPLORE <span className="text-primary">TRENCHES</span>
          <br />
          ON TOP LAUNCHPADS
          <br />
          AND DEXS
        </h2>
        <p className="mt-6 text-lg text-soft">
          Currently available on {avail.map((c) => c.name).join(", ")}.
          <br />
          More chains coming soon.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href={`${ROUTES.terminal}?tab=trending`} className="rounded-md border border-primary px-6 py-2.5 font-bold text-primary">
            GO BACK
          </Link>
          <Link href={ROUTES.trenches()} className="rounded-md bg-primary px-6 py-2.5 font-bold text-ink">
            VIEW TRENCHES
          </Link>
        </div>
      </div>
      <div className="hidden rounded-xl border border-line-2 bg-panel p-3 md:block">
        <div className="grid grid-cols-3 gap-2">
          {["New", "Final Stretch", "Migrated"].map((c) => (
            <div key={c} className="space-y-2">
              <div className="text-xs text-muted">{c}</div>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex items-center gap-2 rounded bg-panel-3 p-2">
                  <span className="h-6 w-6 rounded-full" style={{ background: `hsl(${i * 60 + c.length * 20} 70% 55%)` }} />
                  <span className="h-2 flex-1 rounded bg-line-2" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
