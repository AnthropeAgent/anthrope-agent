"use client";

import Link from "next/link";
import { useState } from "react";
import { ROUTES } from "@/config/brand";
import type { Article } from "@/lib/data/types";
import { ArticleCard } from "./ArticleCard";

/** Bagian artikel di beranda: tab Featured (artikel unggulan) dan Latest (terbaru). */
export function HomePosts({ posts }: { posts: Article[] }) {
  const [tab, setTab] = useState<"featured" | "latest">("featured");
  const featured = posts.filter((p) => p.featured);
  const latest = [...posts].sort((a, b) => b.date.localeCompare(a.date));
  const list = tab === "featured" && featured.length ? featured : latest;
  return (
    <section className="mx-auto max-w-7xl px-4 py-20 md:px-8">
      <div className="flex items-end justify-between gap-4">
        <div className="flex gap-6 font-display text-2xl" role="tablist">
          {(["featured", "latest"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`capitalize ${tab === t ? "text-fg" : "text-muted hover:text-fg"}`}>
              {t}
            </button>
          ))}
        </div>
        <Link href={ROUTES.blog} className="text-sm text-fg/80 hover:text-fg">
          View all →
        </Link>
      </div>
      <div className="no-scrollbar mt-8 flex gap-5 overflow-x-auto pb-2">
        {list.map((a) => (
          <ArticleCard key={a.slug} a={a} base={a.category === "blog" ? "/blog" : "/research"} />
        ))}
      </div>
    </section>
  );
}
