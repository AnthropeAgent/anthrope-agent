import { AgentView } from "@/components/agent/AgentView";
import { dataProvider } from "@/lib/data/provider";

export const metadata = { title: "AI Agent" };

export default async function AgentPage() {
  const [trending, traders] = await Promise.all([dataProvider.listTokens({ tab: "trending", limit: 25 }), dataProvider.getTopTraders()]);
  return <AgentView trending={trending} traders={traders.slice(0, 10)} />;
}
