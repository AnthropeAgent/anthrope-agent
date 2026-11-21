import { AnalystDesk } from "@/components/agent/AnalystDesk";
import { tokenBrief } from "@/lib/agentContext";
import { dataProvider } from "@/lib/data/provider";

export const metadata = { title: "AI Analyst" };
export const dynamic = "force-dynamic";

export default async function AnalystPage() {
  const [trending, traders] = await Promise.all([dataProvider.listTokens({ tab: "trending", limit: 25 }), dataProvider.getTopTraders()]);
  const context = {
    page: "AI analyst (market overview)",
    now: new Date().toISOString(),
    trendingTokens: trending.map(tokenBrief),
    topTraders: traders.slice(0, 10).map((r) => ({ wallet: r.address, pnlUsd: Math.round(r.pnlUsd), roiPct: Math.round(r.roiPct), winRatePct: Math.round(r.winRate), volumeUsd: Math.round(r.volumeUsd), trades: r.trades })),
    notes: "Top traders PnL is computed only from trades observed by this platform, not full wallet history.",
  };
  return (
    <section className="mx-auto max-w-5xl px-4 pt-14 pb-24 md:pt-20">
      <div className="flex items-center gap-3 font-roman text-[11px] tracking-[0.25em] text-gold uppercase">
        <span className="h-px w-8 bg-current" /> The oracle · AI analyst
      </div>
      <h1 className="mt-4 font-serif text-5xl leading-tight text-fg md:text-6xl">Ask in plain words</h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-dim md:text-base">
        Use your own Claude API key. The analyst reads live trending tokens, liquidity, holders, security scans and top-trader flow, then explains what it sees. Requests go
        directly from this browser to Anthropic; the key is never sent to our servers.
      </p>
      <div className="mt-8">
        <AnalystDesk
          context={context}
          suggestions={[
            "Which trending token has the healthiest liquidity vs market cap?",
            "Summarize the market from the trending data right now.",
            "Which tokens show red flags in security or holder concentration?",
            "What are the top traders doing this week?",
          ]}
        />
      </div>
    </section>
  );
}
