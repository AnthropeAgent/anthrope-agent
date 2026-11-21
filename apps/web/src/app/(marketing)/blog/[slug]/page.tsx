import { ArticleBody } from "@/components/marketing/ArticleBody";
import { dataProvider } from "@/lib/data/provider";

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = await dataProvider.getArticle(slug);
  return <ArticleBody a={a} />;
}
