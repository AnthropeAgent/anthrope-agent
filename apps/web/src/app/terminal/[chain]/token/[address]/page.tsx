import { notFound } from "next/navigation";
import { cache } from "react";
import { TokenDetail } from "@/components/terminal/TokenDetail";
import { dataProvider } from "@/lib/data/provider";

// generateMetadata dan halaman memakai token yang sama: satu request ke api per render.
const getToken = cache((chain: string, address: string) => dataProvider.getToken(chain, address));

export async function generateMetadata({ params }: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await params;
  const t = await getToken(chain, address);
  return { title: t ? `${t.symbol} price and chart on ${chain}` : "Token" };
}

export default async function TokenPage({ params }: { params: Promise<{ chain: string; address: string }> }) {
  const { chain, address } = await params;
  const token = await getToken(chain, address);
  if (!token) notFound();
  const [trades, holders, traders, trending, all] = await Promise.all([
    dataProvider.getTrades(token),
    dataProvider.getHolders(token),
    dataProvider.getTopTraders(token.source && token.source !== "mock" ? `${token.chain}:${token.address}` : token.address),
    dataProvider.listTokens({ tab: "trending", limit: 8 }),
    dataProvider.listTokens({ tab: "trending", limit: 60 }),
  ]);
  const fresh = [...all].sort((a, b) => a.ageMinutes - b.ageMinutes).slice(0, 8);
  return <TokenDetail token={token} trades={trades} holders={holders} traders={traders} trending={trending} fresh={fresh} />;
}
