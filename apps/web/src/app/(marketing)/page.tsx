import Link from "next/link";
import { ArrowRight, Bot } from "lucide-react";
import { SectionHeading } from "@/components/marketing/Chrome";
import { HomePosts } from "@/components/marketing/HomePosts";
import { RomanHero } from "@/components/marketing/RomanHero";
import { DualMonitorMockup, TerminalMockup } from "@/components/marketing/Mockups";
import { BRAND, ROUTES } from "@/config/brand";
import { CHAINS } from "@/config/chains";
import { dataProvider } from "@/lib/data/provider";
import { apiGetSiteToken } from "@/lib/data/api";

export default async function HubPage() {
  const [posts, perps, token] = await Promise.all([dataProvider.listArticles(), dataProvider.getPerps(), apiGetSiteToken()]);
  const ticker = perps?.markets.find((m) => m.coin === "BTC") ?? perps?.markets[0] ?? null;
  return (
    <>
      {/* HERO: forum Romawi */}
      <RomanHero ticker={ticker} token={token} />

      {/* CONTOH JAWABAN AGENT */}
      <section className="relative mx-auto -mt-16 max-w-xl px-4 pb-16">
        <div className="rounded-2xl border border-[#d9b56f]/25 bg-[#0e0a08]/90 p-4 text-left text-sm shadow-[0_0_60px_rgba(217,181,111,0.12)] backdrop-blur">
          <div className="mb-3 flex items-center gap-2 text-xs text-muted">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-gold/15 text-gold">
              <Bot size={13} />
            </span>
            <span className="font-roman tracking-[0.12em] uppercase">{BRAND.name} · Analyst</span>
            <span className="ml-auto rounded-full border border-white/10 px-2 py-0.5">example</span>
          </div>
          <div className="ml-auto w-fit max-w-[85%] rounded-lg bg-gold/15 px-3 py-2 text-[#fbf3e4]">Is this token safe to ape into?</div>
          <div className="mt-3 space-y-1.5 text-soft">
            <p>Mint and freeze authority are revoked, but the top 10 wallets hold 48% of supply and LP is only 12% locked.</p>
            <p className="text-muted">Sell pressure doubled in the last hour. Treat it as high risk. Not investment advice.</p>
          </div>
        </div>
      </section>

      {/* MISSION + PRODUCTS */}
      <section id="products" className="mx-auto max-w-7xl px-4 py-24 md:px-8">
        <SectionHeading
          center
          title="A crypto future where power is shared and trust is built on data."
          desc="We give investors and innovators fair access to high-impact crypto intelligence through one product ecosystem."
        />
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {[
            { seg: "For Institutions", items: [[BRAND.products.peak, "The unified institutional digital asset terminal", ROUTES.peak], [BRAND.products.research, "Data-driven crypto research built for action", ROUTES.research]] },
            { seg: "For Builders", items: [[BRAND.products.data, "Decision-grade onchain data provider", ROUTES.dataApi]] },
            { seg: "For Retail Users", items: [[BRAND.products.terminal, "Go-to terminal for winning traders", ROUTES.terminal]] },
          ].map((col) => (
            <div key={col.seg} className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-6">
              <div className="text-sm text-primary">{col.seg}</div>
              <div className="mt-4 space-y-4">
                {col.items.map(([t, d, h]) => (
                  <Link key={t} href={h} className="group block rounded-xl border border-white/5 bg-black/40 p-5 hover:border-white/20">
                    <div className="font-display text-xl text-fg">{t}</div>
                    <div className="mt-1 text-sm">{d}</div>
                    <div className="mt-4 flex items-center gap-1 text-sm text-fg/80 group-hover:text-fg">
                      Explore <ArrowRight size={14} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* TERMINAL */}
      <section className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 md:grid-cols-2 md:px-8">
        <div>
          <SectionHeading
            eyebrow={BRAND.products.terminal}
            title="Built for the winning minds"
            desc="All-in-one trading data tool with real-time price charts, smart money flows, and undiscovered gems."
          />
          <Link href={ROUTES.terminal} className="mt-8 inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 font-medium text-ink">
            Explore Terminal <ArrowRight size={16} />
          </Link>
        </div>
        <TerminalMockup />
      </section>

      {/* STATS */}
      <section className="mx-auto grid max-w-7xl gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 md:grid-cols-3">
        {[
          [String(CHAINS.length), "Chains covered"],
          ["13", "MCP tools for AI agents"],
          ["0", "Private keys we hold"],
        ].map(([v, l]) => (
          <div key={l} className="bg-ink px-8 py-12 text-center">
            <div className="font-display text-5xl font-light text-fg md:text-6xl">{v}</div>
            <div className="mt-2 text-sm">{l}</div>
          </div>
        ))}
      </section>

      {/* DATA */}
      <section className="mx-auto max-w-7xl px-4 py-24 md:px-8">
        <div className="rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_80%_0%,rgba(0,255,163,0.12),transparent_50%)] p-8 md:p-14">
          <SectionHeading
            eyebrow={BRAND.products.data}
            title="Decision-grade blockchain data powering killer apps"
            desc="REST, WebSocket and AI-agent skills for prices, OHLCV, trades, wallets and security across every major chain."
          />
          <Link href={ROUTES.dataApi} className="mt-8 inline-flex items-center gap-2 rounded-md bg-white px-5 py-3 font-medium text-black">
            Explore Data <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* PEAK */}
      <section className="mx-auto max-w-7xl px-4 pb-24 text-center md:px-8">
        <SectionHeading
          center
          eyebrow={BRAND.products.peak}
          title="The unified institutional digital asset terminal"
          desc="Multi-dimensional market data, analytics, insights, news and research, all within a single platform."
        />
        <div className="mt-12">
          <DualMonitorMockup />
        </div>
        <Link href={ROUTES.peak} className="mt-10 inline-flex items-center gap-2 rounded-md border border-white/20 px-5 py-3 font-medium text-fg hover:bg-white/5">
          Explore Peak <ArrowRight size={16} />
        </Link>
      </section>

      {/* BLOG */}
      {posts.length > 0 && <HomePosts posts={posts} />}
    </>
  );
}
