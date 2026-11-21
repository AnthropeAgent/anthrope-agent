import Link from "next/link";
import { Search } from "lucide-react";
import { Logo } from "@/components/Logo";
import { MarketingFooter } from "@/components/marketing/Chrome";
import { ROUTES } from "@/config/brand";

const NAV = [
  ["Research", "/research/all"],
  ["Reports", "/research/category/flagship-reports"],
  ["Insights", "/research/category/insight-articles"],
  ["Data Services", ROUTES.dataApi],
  ["Real-time Dashboard", ROUTES.terminal],
];

export default function ResearchLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-ink text-dim">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-ink/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 md:px-8">
          <Logo href={ROUTES.research} />
          <nav className="no-scrollbar flex flex-1 items-center gap-1 overflow-x-auto">
            {NAV.map(([l, h]) => (
              <Link key={l} href={h} className="rounded-md px-3 py-2 text-sm whitespace-nowrap text-fg/90 hover:text-fg">
                {l}
              </Link>
            ))}
          </nav>
          <button className="hidden items-center gap-2 text-sm text-fg/80 md:flex">
            <Search size={16} /> Search
          </button>
        </div>
      </header>
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}
