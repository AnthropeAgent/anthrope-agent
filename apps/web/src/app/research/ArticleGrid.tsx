import { ArticleCard } from "@/components/marketing/ArticleCard";
import { SectionHeading } from "@/components/marketing/Chrome";
import type { Article } from "@/lib/data/types";

export function ArticleGrid({ title, items }: { title: string; items: Article[] }) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-20 md:px-8">
      <SectionHeading title={title} />
      <div className="mt-12 flex flex-wrap gap-5">
        {items.map((a) => (
          <ArticleCard key={a.slug} a={a} />
        ))}
      </div>
    </div>
  );
}
