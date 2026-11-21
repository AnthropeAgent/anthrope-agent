import { dataProvider, dataSource } from "@/lib/data/provider";
import { TrackersView } from "./TrackersView";

export const metadata = { title: "Trackers" };

export default async function TrackersPage() {
  const [traders, tokens] = await Promise.all([dataProvider.getTopTraders(), dataProvider.listTokens({ tab: "trending", limit: 6 })]);
  // Top traders: agregasi worker dari transaksi terpantau (langkah 8). Live trades: deret trades yang sudah
  // di-cache untuk 3 token trending teratas (worker sudah memantaunya untuk agregasi traders).
  const tradeLists = await Promise.all(tokens.slice(0, dataSource === "api" ? 3 : 6).map((t) => dataProvider.getTrades(t)));
  const live = tradeLists
    .flatMap((ts, i) => ts.slice(0, 8).map((x) => ({ ...x, symbol: tokens[i].symbol })))
    .sort((a, b) => b.time - a.time);
  return <TrackersView traders={traders} live={live} />;
}
