import { Suspense } from "react";
import { DiscoverView } from "@/components/terminal/DiscoverView";
import type { ChainId } from "@/config/chains";
import { dataProvider } from "@/lib/data/provider";
import type { DiscoverTab, Timeframe } from "@/lib/data/types";

export const metadata = { title: "Discover" };

const TABS: DiscoverTab[] = ["top-mc", "trending", "trenches", "rwas"];
const TFS: Timeframe[] = ["5m", "1h", "4h", "24h"];

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tab = (TABS.includes(sp.tab as DiscoverTab) ? sp.tab : "trending") as DiscoverTab;
  const tf = (TFS.includes(sp.tf as Timeframe) ? sp.tf : "24h") as Timeframe;
  const chain = sp.chain ?? "all";
  const tokens = await dataProvider.listTokens({ tab, chain: chain as ChainId | "all", timeframe: tf, limit: 60 });
  return (
    <Suspense>
      <DiscoverView tokens={tokens} tab={tab} chain={chain} tf={tf} />
    </Suspense>
  );
}
