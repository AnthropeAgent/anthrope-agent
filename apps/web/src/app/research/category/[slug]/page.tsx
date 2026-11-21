import { notFound } from "next/navigation";
import { dataProvider } from "@/lib/data/provider";
import type { Article } from "@/lib/data/types";
import { ArticleGrid } from "../../ArticleGrid";

const TITLES: Record<string, string> = { "flagship-reports": "Flagship reports", "insight-articles": "Insight articles" };

export default async function ResearchCategory({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!TITLES[slug]) notFound();
  const items = await dataProvider.listArticles(slug as Article["category"]);
  return <ArticleGrid title={TITLES[slug]} items={items} />;
}
