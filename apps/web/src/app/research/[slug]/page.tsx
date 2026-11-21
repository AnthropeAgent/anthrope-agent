import { ArticleBody } from "@/components/marketing/ArticleBody";
import { dataProvider } from "@/lib/data/provider";

export default async function ResearchArticle({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = await dataProvider.getArticle(slug);
  if (a?.category === "blog") return <ArticleBody a={undefined} />;
  return <ArticleBody a={a} />;
}
