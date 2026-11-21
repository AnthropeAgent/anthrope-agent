import Link from "next/link";
import { BarChart3, Building2, FileSearch, Landmark, LineChart, Newspaper, Wallet } from "lucide-react";
import { MarketingFooter, MarketingNav, SectionHeading } from "@/components/marketing/Chrome";
import { ContactForm } from "@/components/marketing/ContactForm";
import { DualMonitorMockup } from "@/components/marketing/Mockups";
import { PeakTabs } from "@/components/marketing/PeakTabs";
import { BRAND, ROUTES } from "@/config/brand";

export const metadata = { title: "Peak: The Institutional Digital Asset Terminal" };

const SOLUTIONS = [
  { i: FileSearch, t: "Transparent asset fundamentals", d: "Token profiles, supply and unlock schedules, vesting, allocations, dilution, valuation and holder concentration, verified and standardized." },
  { i: LineChart, t: "Unified market intelligence", d: "Real-time and historical markets across DeFi, spot, derivatives and ETF flows in a single terminal." },
  { i: Building2, t: "Integrated investment hub", d: "Browse curated fundraising rounds, request data-room access, and engage project teams directly." },
  { i: BarChart3, t: "Deep protocol analytics", d: "Protocol performance, competitive landscape, usage metrics and user profiles." },
  { i: Wallet, t: "Comprehensive wallet analytics", d: "PnL attribution, exposure, fund flows, historical transactions and net worth across chains." },
  { i: Landmark, t: "Institutional-grade indices", d: "Sector breakdowns, weighted composites and reference prices to benchmark exposure." },
  { i: Newspaper, t: "Curated news and research", d: "Filings, regulation, protocol announcements, token movements and macro context, filtered for relevance." },
];

const INSTITUTIONS = [
  ["Prop trading firms", ["Ultra-low latency data", "Scalable infrastructure", "Aggregated insights", "Flexible delivery"]],
  ["Venture capital firms", ["Wallet & contract monitoring", "Distribution schedules", "Fundraising history", "Competitive landscape"]],
  ["Asset managers", ["Real-time valuation", "Liquidity & depth", "Compliance & audit data", "Onchain yield"]],
  ["Fintech firms", ["Real-time pricing", "Onchain activity", "Entity tracking", "Release schedules"]],
  ["Investment banks", ["DeFi fundamentals", "Historical asset data", "Classification & metadata", "Liquidity metrics"]],
  ["Family offices", ["Portfolio analytics", "Risk monitoring", "Signal detection", "Due diligence"]],
] as const;

export default function PeakPage() {
  return (
    <div className="min-h-dvh bg-ink text-dim">
      <MarketingNav
        logoHref={ROUTES.peak}
        logoSub="Peak"
        items={[
          { label: "Solutions", children: SOLUTIONS.slice(0, 4).map((s) => ({ label: s.t, href: "#solutions" })) },
          { label: "Institutions", children: INSTITUTIONS.slice(0, 4).map(([n]) => ({ label: n, href: "#institutions" })) },
          { label: "Use Cases", children: [{ label: "Research", href: "#highlights" }, { label: "Risk", href: "#highlights" }] },
          { label: "Research", href: ROUTES.research },
        ]}
        secondary={{ label: "Sign Up", href: "/login?next=/peak/app" }}
        cta={{ label: "Launch Terminal ↗", href: ROUTES.peakApp }}
      />

      <section className="relative overflow-hidden px-4 pt-24 pb-16 text-center">
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#e8c9a6]/15 to-transparent" />
        <h1 className="relative mx-auto max-w-4xl font-display text-4xl font-light text-fg md:text-6xl">The Unified Institutional Digital Asset Terminal</h1>
        <p className="relative mx-auto mt-6 max-w-2xl text-lg">Multi-dimensional market data, analytics, insights, news and research in one platform.</p>
        <div className="relative mt-14">
          <DualMonitorMockup />
        </div>
      </section>

      <section id="solutions" className="mx-auto max-w-7xl px-4 py-24 md:px-8">
        <SectionHeading eyebrow="Solutions" title="Full visibility into the digital asset market" />
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {SOLUTIONS.map(({ i: Icon, t, d }) => (
            <div key={t} className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.03] to-transparent p-6">
              <Icon className="text-[#e8c9a6]" />
              <div className="mt-5 text-lg text-fg">{t}</div>
              <p className="mt-2 text-sm leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col items-center justify-between gap-6 rounded-2xl border border-white/10 bg-panel p-8 md:flex-row">
          <div className="font-display text-2xl text-fg">Thousands of institutional-grade metrics. One terminal.</div>
          <a href="#contact" className="rounded-md bg-white px-5 py-3 font-medium text-black">
            Request a demo
          </a>
        </div>
      </section>

      <section id="highlights" className="mx-auto max-w-6xl px-4 py-20 md:px-8">
        <SectionHeading center eyebrow="Highlights" title="Powerful and flexible tools for your daily workflow" />
        <div className="mt-12">
          <PeakTabs />
        </div>
      </section>

      <section id="institutions" className="mx-auto max-w-7xl px-4 py-20 md:px-8">
        <SectionHeading eyebrow="Institutions" title="Tailored for institutions & professionals" />
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {INSTITUTIONS.map(([n, items]) => (
            <div key={n} className="rounded-2xl border border-white/10 p-6">
              <div className="text-lg text-fg">{n}</div>
              <ul className="mt-4 space-y-2 text-sm">
                {items.map((x) => (
                  <li key={x} className="flex gap-2">
                    <span className="text-[#e8c9a6]">✓</span>
                    {x}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section id="contact" className="mx-auto grid max-w-7xl gap-10 px-4 py-20 md:grid-cols-2 md:px-8">
        <SectionHeading eyebrow="Contact Sales" title="Schedule a demo customized to your use case" desc={`See how ${BRAND.products.peak} fits your workflow.`} />
        <ContactForm />
      </section>
      <div className="pb-10 text-center">
        <Link href={ROUTES.peakApp} className="text-sm text-[#e8c9a6] hover:underline">
          Already a client? Launch Terminal →
        </Link>
      </div>
      <MarketingFooter />
    </div>
  );
}
