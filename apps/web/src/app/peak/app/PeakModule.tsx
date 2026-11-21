import Link from "next/link";
import { AnalystPanel } from "@/components/agent/AnalystPanel";
import { tokenBrief } from "@/lib/agentContext";
import { ROUTES } from "@/config/brand";
import { dataProvider } from "@/lib/data/provider";
import type { PerpsDoc, Token } from "@/lib/data/types";
import { fmtPct, fmtPrice, fmtUsd, pctClass } from "@/lib/format";

/** Langkah 14: modul dengan sumber data memakai data asli; sisanya menunggu sumber data (lihat ARCHITECTURE §11). */
const TITLES: Record<string, [string, string, "live" | "planned"]> = {
  overview: ["Overview", "Ringkasan pasar spot dan perps.", "live"],
  markets: ["Market intelligence", "Spot (DEX) dan derivatif (Hyperliquid).", "live"],
  wallets: ["Wallet analytics", "Top traders dari transaksi terpantau dan profil wallet.", "live"],
  news: ["News & research", "Artikel riset dari CMS.", "live"],
  ai: ["Peak AI", "Asisten AI untuk riset aset digital, memakai API key Claude milikmu.", "live"],
  assets: ["Asset fundamentals", "Supply & unlock, vesting, alokasi, valuasi.", "planned"],
  protocols: ["Protocol analytics", "Performa protokol, peta kompetitor, metrik pengguna.", "planned"],
  indices: ["Indices", "Indeks sektor, komposit berbobot, reference price.", "planned"],
  deals: ["Investment hub", "Deal fundraising, data room, request access.", "planned"],
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-white/10">
      <div className="border-b border-white/10 px-4 py-2.5 text-sm text-fg">{title}</div>
      {children}
    </section>
  );
}

function TokenTable({ tokens }: { tokens: Token[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="num w-full text-sm">
        <thead className="text-xs text-muted">
          <tr>
            {["Asset", "Price", "24h", "Market Cap", "Volume 24h", "Liquidity"].map((h) => (
              <th key={h} className="px-4 py-2 text-right font-normal first:text-left">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => (
            <tr key={`${t.chain}:${t.address}`} className="border-t border-white/5 hover:bg-white/[0.03]">
              <td className="px-4 py-2">
                <Link href={ROUTES.token(t.chain, t.address)} className="text-fg hover:underline">
                  {t.symbol}
                </Link>
                <span className="ml-1.5 text-xs text-muted">{t.chain}</span>
              </td>
              <td className="px-4 py-2 text-right">{fmtPrice(t.price)}</td>
              <td className={`px-4 py-2 text-right ${pctClass(t.change["24h"])}`}>{fmtPct(t.change["24h"])}</td>
              <td className="px-4 py-2 text-right">{fmtUsd(t.marketCap)}</td>
              <td className="px-4 py-2 text-right">{fmtUsd(t.volume24h)}</td>
              <td className="px-4 py-2 text-right">{fmtUsd(t.liquidity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PerpsMini({ perps }: { perps: PerpsDoc | null }) {
  if (!perps) return <p className="p-4 text-sm text-muted">Data perps sedang disiapkan worker.</p>;
  return (
    <div className="num divide-y divide-white/5 text-sm">
      {perps.markets.slice(0, 8).map((m) => (
        <div key={m.coin} className="flex items-center gap-3 px-4 py-2">
          <span className="w-16 text-fg">{m.coin}</span>
          <span className="flex-1 text-right">{fmtPrice(m.markPx)}</span>
          <span className={`w-16 text-right ${pctClass(m.change24hPct)}`}>{fmtPct(m.change24hPct)}</span>
          <span className="w-20 text-right text-muted">OI {fmtUsd(m.openInterestUsd)}</span>
        </div>
      ))}
      <Link href={ROUTES.perps} className="block px-4 py-2 text-xs text-primary hover:underline">
        Distribusi posisi lengkap →
      </Link>
    </div>
  );
}

export async function PeakModule({ slug }: { slug: string }) {
  const [title, desc, state] = TITLES[slug] ?? [slug, "Modul Peak", "planned"];
  const head = (
    <div>
      <h1 className="font-display text-2xl text-fg">{title}</h1>
      <p className="text-sm text-muted">{desc}</p>
    </div>
  );

  if (state === "planned")
    return (
      <div className="space-y-4">
        {head}
        <div className="rounded-lg border border-dashed border-white/15 p-8 text-center text-sm text-muted">
          <div className="text-fg">Belum ada sumber data</div>
          <p className="mx-auto mt-1 max-w-md">Modul ini butuh data fundamental (unlock, vesting, protokol, deal) dari provider berbayar atau riset internal. Belum dikonfigurasi.</p>
        </div>
      </div>
    );

  if (slug === "ai") {
    const [tokens, perps] = await Promise.all([dataProvider.listTokens({ tab: "top-mc", limit: 30 }), dataProvider.getPerps()]);
    const context = { page: "Peak research", now: new Date().toISOString(), topAssets: tokens.map(tokenBrief), perpsMarkets: perps?.markets.slice(0, 20) ?? null };
    return (
      <div className="flex h-[calc(100dvh-140px)] min-h-[520px] flex-col gap-4">
        {head}
        <div className="min-h-0 flex-1">
          <AnalystPanel
            title="Peak AI"
            context={context}
            suggestions={["Bandingkan valuasi aset top berdasarkan likuiditas dan volume.", "Pasar perps mana yang funding-nya paling ekstrem sekarang?", "Ringkas kondisi pasar hari ini untuk laporan singkat."]}
          />
        </div>
      </div>
    );
  }

  if (slug === "news") {
    const articles = (await dataProvider.listArticles()).slice(0, 20);
    return (
      <div className="space-y-4">
        {head}
        <Panel title="Research & blog terbaru">
          <div className="divide-y divide-white/5">
            {articles.map((a) => (
              <Link key={a.slug} href={`/${a.category === "blog" ? "blog" : "research"}/${a.slug}`} className="block px-4 py-3 hover:bg-white/[0.03]">
                <div className="text-fg">{a.title}</div>
                <div className="text-xs text-muted">
                  {a.category} · {a.date}
                </div>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    );
  }

  if (slug === "wallets") {
    const traders = (await dataProvider.getTopTraders()).slice(0, 20);
    return (
      <div className="space-y-4">
        {head}
        <Panel title="Top traders (dari transaksi terpantau)">
          <div className="num divide-y divide-white/5 text-sm">
            {!traders.length && <p className="p-4 text-muted">Belum ada data.</p>}
            {traders.map((r) => (
              <Link key={r.address} href={ROUTES.wallet(r.address)} className="flex items-center gap-3 px-4 py-2 hover:bg-white/[0.03]">
                <span className="w-6 text-muted">{r.rank}</span>
                <span className="flex-1 truncate font-mono text-xs text-fg">{r.address}</span>
                <span className={`w-24 text-right ${pctClass(r.pnlUsd)}`}>{fmtUsd(r.pnlUsd)}</span>
                <span className="w-20 text-right text-muted">{fmtUsd(r.volumeUsd)}</span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    );
  }

  const [top, trending, perps] = await Promise.all([
    dataProvider.listTokens({ tab: "top-mc", limit: 12 }),
    slug === "markets" ? dataProvider.listTokens({ tab: "trending", limit: 12 }) : Promise.resolve([] as Token[]),
    dataProvider.getPerps(),
  ]);
  return (
    <div className="space-y-4">
      {head}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Panel title="Top assets (market cap)">
            <TokenTable tokens={top} />
          </Panel>
          {slug === "markets" && (
            <Panel title="Trending (DEX)">
              <TokenTable tokens={trending} />
            </Panel>
          )}
        </div>
        <Panel title="Perps · Hyperliquid">
          <PerpsMini perps={perps} />
        </Panel>
      </div>
    </div>
  );
}
