import { notFound } from "next/navigation";
import { TrenchesBoard } from "@/components/terminal/TrenchesBoard";
import { chainById } from "@/config/chains";
import { dataProvider } from "@/lib/data/provider";

export const metadata = { title: "Trenches" };

export default async function TrenchesPage({ params }: { params: Promise<{ chain: string }> }) {
  const { chain } = await params;
  const c = chainById(chain);
  if (!c?.trenches) notFound();
  const items = await dataProvider.getTrenches(c.id);
  return <TrenchesBoard chain={c.id} items={items} />;
}
