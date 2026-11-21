import { ArticleCard } from "@/components/marketing/ArticleCard";
import { SectionHeading } from "@/components/marketing/Chrome";
import { dataProvider } from "@/lib/data/provider";

export const metadata = { title: "Blog" };

export default async function BlogPage() {
  const posts = await dataProvider.listArticles("blog");
  return (
    <div className="mx-auto max-w-7xl px-4 py-20 md:px-8">
      <SectionHeading title="Blog" desc="Product updates, announcements and monthly roundups." />
      {posts.length === 0 && <p className="mt-12 text-sm text-muted">No posts yet. Check back soon.</p>}
      <div className="mt-12 flex flex-wrap gap-5">
        {posts.map((a) => (
          <ArticleCard key={a.slug} a={a} base="/blog" />
        ))}
      </div>
    </div>
  );
}
