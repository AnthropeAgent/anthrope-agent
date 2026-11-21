"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useLiveStatus } from "@/lib/data/ws";
import {
  Bot,
  ArrowLeftRight,
  Bell,
  BookOpen,
  CandlestickChart,
  ChevronDown,
  Flame,
  Layers,
  LayoutGrid,
  Menu,
  PanelRight,
  Pickaxe,
  Radar,
  Search,
  Settings,
  Sparkles,
  Star,
  Tag,
  TrendingUp,
  X,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { SearchBox } from "@/components/SearchBox";
import { AccountButton } from "@/components/account/AccountButton";
import { AlertsPanel } from "@/components/alerts/AlertsPanel";
import { useAlertEvents } from "@/lib/alerts";
import { WatchlistPanel } from "@/components/account/WatchlistPanel";
import { BRAND, ROUTES } from "@/config/brand";
import { dataSource } from "@/lib/data/provider";
import { SocialLinks } from "@/components/marketing/SocialLinks";
import { fmtPrice } from "@/lib/format";

const DRAWER = [
  { label: "Trending", href: `${ROUTES.terminal}?tab=trending`, icon: Flame },
  { label: "Trenches", href: ROUTES.trenches(), icon: Pickaxe },
  { label: "Trackers", href: ROUTES.trackers, icon: Radar },
  { label: "AI Agent", href: ROUTES.terminalAgent, icon: Bot, badge: "New" },
  { label: "Supercharts", href: ROUTES.supercharts, icon: CandlestickChart },
  { label: "Perps", href: ROUTES.perps, icon: TrendingUp },
  { label: "Peak", href: ROUTES.peak, icon: LayoutGrid, badge: "New" },
  { label: "Data Skills", href: ROUTES.dataApi, icon: Sparkles, badge: "New" },
  { label: "Research", href: ROUTES.research, icon: BookOpen },
];

const TOOLS = [
  { label: "Find Trades", href: ROUTES.findTrades },
  { label: "Supercharts", href: ROUTES.supercharts },
  { label: "Multicharts", href: ROUTES.multicharts },
  { label: "Embed Chart", href: ROUTES.embed },
];

type Panel = null | "swap" | "watchlist" | "alerts" | "tags";

function useTicker() {
  const [p, setP] = useState({ BTC: 58388.48, ETH: 1603.51, SOL: 67.41 });
  useEffect(() => {
    const id = setInterval(
      () =>
        setP((v) => ({
          BTC: v.BTC * (1 + (Math.random() - 0.5) * 0.0008),
          ETH: v.ETH * (1 + (Math.random() - 0.5) * 0.001),
          SOL: v.SOL * (1 + (Math.random() - 0.5) * 0.0015),
        })),
      3000,
    );
    return () => clearInterval(id);
  }, []);
  return p;
}

export function TerminalShell({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const [tools, setTools] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [banner, setBanner] = useState(true);
  const path = usePathname();
  const ticker = useTicker();

  useEffect(() => {
    setDrawer(false);
    setTools(false);
  }, [path]);

  const alertFeed = useAlertEvents();
  const rail: { k: Exclude<Panel, null>; icon: typeof Star; label: string }[] = [
    { k: "swap", icon: ArrowLeftRight, label: "Quick swap" },
    { k: "watchlist", icon: Star, label: "Watchlist" },
    { k: "alerts", icon: Bell, label: "Alerts" },
    { k: "tags", icon: Tag, label: "Wallet tags" },
  ];

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-bg text-soft">
      {/* TOPBAR */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-3">
        <button aria-label="Open app menu" onClick={() => setDrawer(true)} className="grid h-8 w-8 place-items-center rounded-md bg-panel-3 text-soft hover:text-fg">
          <Menu size={17} />
        </button>
        <Logo href={ROUTES.terminal} className="hidden sm:flex" />
        <div className="ml-auto w-full max-w-[150px] sm:max-w-[220px] md:max-w-xs">
          <SearchBox />
        </div>
        <div className="relative">
          <button aria-label="Open tools menu" onClick={() => setTools((v) => !v)} className="flex h-8 items-center gap-0.5 rounded-md bg-panel-3 px-2 text-soft hover:text-fg">
            <Layers size={16} />
            <ChevronDown size={12} />
          </button>
          {tools && (
            <div className="absolute top-full right-0 z-50 mt-1 w-48 rounded-lg border border-line-2 bg-panel p-1 shadow-2xl">
              {TOOLS.map((t) => (
                <Link key={t.label} href={t.href} className="block rounded-md px-3 py-2 text-sm hover:bg-panel-3">
                  {t.label}
                </Link>
              ))}
            </div>
          )}
        </div>
        <button aria-label="Watchlist" onClick={() => setPanel("watchlist")} className="hidden h-8 w-8 place-items-center rounded-md bg-panel-3 text-soft hover:text-fg sm:grid">
          <Star size={16} />
        </button>
        <AccountButton onWatchlist={() => setPanel("watchlist")} />
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 overflow-hidden">{children}</main>

        {/* RIGHT RAIL */}
        <aside className="hidden w-11 shrink-0 flex-col items-center gap-1 border-l border-line py-2 md:flex">
          {rail.map(({ k, icon: Icon, label }) => (
            <button
              key={k}
              aria-label={label}
              title={label}
              onClick={() => setPanel((p) => (p === k ? null : k))}
              className={`relative grid h-9 w-9 place-items-center rounded-md ${panel === k ? "bg-panel-3 text-primary" : "text-muted hover:text-fg"}`}
            >
              <Icon size={18} />
              {k === "alerts" && alertFeed.unread > 0 && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-down" />}
            </button>
          ))}
          <button aria-label="Toggle panel" className="grid h-9 w-9 place-items-center rounded-md text-muted hover:text-fg" onClick={() => setPanel((p) => (p ? null : "watchlist"))}>
            <PanelRight size={18} />
          </button>
          <button aria-label="Settings" className="mt-auto grid h-9 w-9 place-items-center rounded-md text-muted hover:text-fg">
            <Settings size={18} />
          </button>
        </aside>

        {panel && (
          <aside className="absolute top-12 right-0 bottom-9 z-30 w-80 border-l border-line bg-panel shadow-2xl md:right-11">
            <div className="flex h-11 items-center justify-between border-b border-line px-4 text-sm text-fg capitalize">
              {panel === "swap" ? "Quick swap" : panel}
              <button aria-label="Close panel" onClick={() => setPanel(null)} className="text-muted hover:text-fg">
                <X size={16} />
              </button>
            </div>
            {panel === "alerts" && (
              <div className="absolute inset-x-0 top-11 bottom-0">
                <AlertsPanel events={alertFeed.events} loggedIn={alertFeed.loggedIn} onOpen={alertFeed.markSeen} />
              </div>
            )}
            {panel === "watchlist" && (
              <div className="absolute inset-x-0 top-11 bottom-0">
                <WatchlistPanel />
              </div>
            )}
            <div className="p-4 text-sm text-muted">
              {panel === "swap" && "Swap tersedia di halaman token (panel Buy/Sell, ditandatangani di wallet kamu)."}
              {panel === "tags" && "Beri label pada wallet yang kamu pantau."}
            </div>
          </aside>
        )}
      </div>

      {/* BOTTOM BANNER */}
      {banner && (
        <div className="relative hidden shrink-0 items-center justify-center gap-2 border-t border-up/20 bg-[linear-gradient(90deg,rgba(0,255,163,0.06),rgba(0,0,0,0)_40%,rgba(0,255,163,0.06))] py-2 text-sm text-fg md:flex">
          {dataSource === "api" ? (
            <>
              Market data:{" "}
              <a href="https://www.geckoterminal.com" target="_blank" rel="noreferrer noopener" className="text-[#00ffa3] hover:underline">
                GeckoTerminal
              </a>
              ·
              <a href="https://dexscreener.com" target="_blank" rel="noreferrer noopener" className="text-[#00ffa3] hover:underline">
                DEX Screener
              </a>
              <LiveDot />
            </>
          ) : (
            <>
              Data powered by <span className="font-display font-semibold text-[#00ffa3]">{BRAND.products.data}</span>
              <Link href={ROUTES.dataApi} className="text-xs text-muted underline hover:text-fg">
                Get API key
              </Link>
            </>
          )}
          <button aria-label="Close banner" onClick={() => setBanner(false)} className="absolute right-4 text-muted hover:text-fg">
            <X size={14} />
          </button>
        </div>
      )}

      {/* FOOTER TICKER */}
      <footer className="flex h-9 shrink-0 items-center gap-4 border-t border-line px-3 text-xs">
        <button className="flex items-center gap-1 text-soft">
          Docs <ChevronDown size={12} />
        </button>
        <div className="num mx-auto flex items-center gap-5">
          {([
            ["BTC", "#F7931A"],
            ["ETH", "#627EEA"],
            ["SOL", "#9945FF"],
          ] as const).map(([s, c]) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="h-3.5 w-3.5 rounded-full" style={{ background: c }} />
              {fmtPrice(ticker[s])}
            </span>
          ))}
        </div>
        <SocialLinks className="hidden sm:flex" />
      </footer>

      {/* DRAWER */}
      {drawer && (
        <div className="fixed inset-0 z-50 bg-black/60" onClick={() => setDrawer(false)}>
          <nav className="h-full w-72 border-r border-line bg-panel p-3" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between px-2 py-1">
              <Logo href={ROUTES.terminal} />
              <button aria-label="Close menu" onClick={() => setDrawer(false)} className="text-muted hover:text-fg">
                <X size={18} />
              </button>
            </div>
            <div className="mb-3 md:hidden">
              <SearchBox />
            </div>
            {DRAWER.map(({ label, href, icon: Icon, badge }) => (
              <Link key={label} href={href} className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-soft hover:bg-panel-3 hover:text-fg">
                <Icon size={17} className="text-muted" />
                {label}
                {badge && <span className="ml-auto rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">{badge}</span>}
              </Link>
            ))}
            <div className="my-3 border-t border-line" />
            <Link href="/" className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-muted hover:text-fg">
              <Search size={17} /> {BRAND.name} home
            </Link>
          </nav>
        </div>
      )}
    </div>
  );
}

/** Status koneksi realtime (/ws). Hanya tampil setelah ada yang subscribe. */
function LiveDot() {
  const status = useLiveStatus();
  if (status === "idle") return null;
  const open = status === "open";
  return (
    <span className="ml-2 inline-flex items-center gap-1.5 text-xs text-muted" title={open ? "Terhubung ke stream realtime" : "Menyambung ulang ke stream realtime"}>
      <span className={`h-1.5 w-1.5 rounded-full ${open ? "bg-up" : "bg-warn"}`} />
      {open ? "Live" : "Menyambung…"}
    </span>
  );
}
