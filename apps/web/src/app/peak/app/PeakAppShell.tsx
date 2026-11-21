"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, Bot, Building2, Coins, Download, Landmark, LineChart, Newspaper, Search, Star, Wallet } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { BRAND, ROUTES } from "@/config/brand";

export const PEAK_MODULES = [
  { slug: "assets", label: "Assets", icon: Coins },
  { slug: "markets", label: "Markets", icon: LineChart },
  { slug: "protocols", label: "Protocols", icon: BarChart3 },
  { slug: "wallets", label: "Wallets", icon: Wallet },
  { slug: "indices", label: "Indices", icon: Landmark },
  { slug: "deals", label: "Deals", icon: Building2 },
  { slug: "news", label: "News", icon: Newspaper },
  { slug: "ai", label: "Peak AI", icon: Bot },
];

export function PeakAppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [cmd, setCmd] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmd((v) => !v);
      }
      if (e.key === "Escape") setCmd(false);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const matches = PEAK_MODULES.filter((m) => m.label.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex h-dvh bg-bg text-soft">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-white/10 md:flex">
        <Link href={ROUTES.peakApp} className="flex h-14 items-center gap-2 border-b border-white/10 px-4 text-fg">
          <LogoMark size={22} />
          <span className="font-display">{BRAND.products.peak}</span>
        </Link>
        <nav className="flex-1 space-y-0.5 p-2">
          {PEAK_MODULES.map(({ slug, label, icon: Icon }) => {
            const href = `${ROUTES.peakApp}/${slug}`;
            const on = path === href;
            return (
              <Link key={slug} href={href} className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${on ? "bg-[#e8c9a6]/15 text-[#e8c9a6]" : "hover:bg-white/5"}`}>
                <Icon size={16} /> {label}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-1 border-t border-white/10 p-2 text-sm">
          <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 hover:bg-white/5">
            <Star size={16} /> Watchlist
          </button>
          <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 hover:bg-white/5">
            <Download size={16} /> Export CSV
          </button>
          <Link href={ROUTES.terminal} className="block rounded-md px-3 py-2 text-xs text-muted hover:text-fg">
            ← Retail Terminal
          </Link>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-white/10 px-4">
          <button onClick={() => setCmd(true)} className="flex h-9 flex-1 items-center gap-2 rounded-md border border-white/10 bg-bg px-3 text-sm text-muted md:max-w-md">
            <Search size={15} /> Search assets, wallets, commands…
            <kbd className="ml-auto rounded bg-white/10 px-1.5 text-[11px]">Ctrl K</kbd>
          </button>
          <span className="ml-auto rounded bg-up/15 px-2 py-1 text-xs text-up">● Live</span>
        </header>
        <main className="scrollbar-thin min-h-0 flex-1 overflow-auto p-4">{children}</main>
      </div>

      {cmd && (
        <div className="fixed inset-0 z-50 grid place-items-start bg-black/60 pt-[15vh]" onClick={() => setCmd(false)}>
          <div className="mx-auto w-full max-w-lg overflow-hidden rounded-xl border border-white/10 bg-panel" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches[0]) {
                  router.push(`${ROUTES.peakApp}/${matches[0].slug}`);
                  setCmd(false);
                }
              }}
              placeholder="Type a command or module…"
              className="w-full border-b border-white/10 bg-transparent px-4 py-3 text-fg outline-none"
            />
            {matches.map(({ slug, label, icon: Icon }) => (
              <button
                key={slug}
                onClick={() => {
                  router.push(`${ROUTES.peakApp}/${slug}`);
                  setCmd(false);
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-white/5"
              >
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
