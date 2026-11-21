import { dataProvider } from "@/lib/data/provider";
import { ArticleGrid } from "../ArticleGrid";

export default async function AllResearch() {
  const items = (await dataProvider.listArticles()).filter((a) => a.category !== "blog");
  return <ArticleGrid title="All research" items={items} />;
}
