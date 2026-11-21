import Link from "next/link";
import { ArticleCard } from "@/components/marketing/ArticleCard";
import { SectionHeading } from "@/components/marketing/Chrome";
import { BRAND } from "@/config/brand";
import { CHAINS } from "@/config/chains";
import { dataProvider } from "@/lib/data/provider";
import { FeaturedCarousel } from "./FeaturedCarousel";

export const metadata = { title: "Research" };

export default async function ResearchPage() {
  const all = (await dataProvider.listArticles()).filter((a) => a.category !== "blog");
  const featured = all.filter((a) => a.featured).slice(0, 3);
  const flagship = all.filter((a) => a.category === "flagship-reports");
  return (
    <>
      {featured.length > 0 && <FeaturedCarousel items={featured} />}

      <section className="mx-auto max-w-7xl px-4 py-24 md:px-8">
        <SectionHeading
          title="Data-driven crypto research built for action"
          desc={`${BRAND.products.research} turns multi-source market data into clear, actionable intelligence for traders, builders, and institutions.`}
        />
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="#bespoke" className="rounded-md bg-white px-5 py-3 font-medium text-black">
            Commission a report
          </a>
          {featured[0] && (
          <Link href={`/research/${featured[0].slug}`} className="rounded-md border border-white/20 px-5 py-3 font-medium text-fg">
            Read latest report
          </Link>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 md:px-8">
        <div className="mb-6 text-sm text-primary">Why {BRAND.name}?</div>
        <div className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 md:grid-cols-4">
          {[
            [String(CHAINS.length), "Chains covered"],
            ["Live", "Prices, liquidity and holders"],
            ["13", "MCP tools for AI agents"],
            ["Read-only", "Never signs a transaction"],
          ].map(([v, l]) => (
            <div key={l} className="bg-ink p-8">
              <div className="font-display text-4xl font-light text-fg">{v}</div>
              <div className="mt-2 text-sm">{l}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-24 md:px-8">
        <div className="flex items-end justify-between">
          <SectionHeading title="Industry-leading flagship reports" desc="Market data consolidated into digestible insights." />
          <Link href="/research/category/flagship-reports" className="shrink-0 text-sm text-fg/80 hover:text-fg">
            Explore all →
          </Link>
        </div>
        <div className="no-scrollbar mt-10 flex gap-5 overflow-x-auto pb-2">
          {flagship.map((a) => (
            <ArticleCard key={a.slug} a={a} />
          ))}
        </div>
      </section>

      <section id="bespoke" className="mx-auto max-w-7xl px-4 pb-24 md:px-8">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <SectionHeading title="Bespoke report services" desc="Custom analyses and visual dashboards for projects and institutions." />
          <Link href="/data-api#contact" className="shrink-0 rounded-md bg-white px-5 py-3 font-medium text-black">
            Get in touch
          </Link>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            ["Data-backed storytelling", "Complex metrics turned into clear narratives backed by onchain data."],
            ["Institution-grade credibility", "Transparent methodology for third-party validation."],
            ["Boosted brand visibility", "Distribution across our channels and industry networks."],
            ["Compelling visual intelligence", "Crisp charts and interactive dashboards."],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-white/10 p-6">
              <div className="text-fg">{t}</div>
              <p className="mt-2 text-sm">{d}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
