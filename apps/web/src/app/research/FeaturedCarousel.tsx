"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { ArticleCover } from "@/components/marketing/ArticleCard";
import type { Article } from "@/lib/data/types";

export function FeaturedCarousel({ items }: { items: Article[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % items.length), 6000);
    return () => clearInterval(id);
  }, [items.length]);
  const a = items[i];
  return (
    <section className="relative h-[560px] overflow-hidden md:h-[620px]">
      <ArticleCover a={a} className="absolute inset-0 transition-all duration-700" />
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent" />
      <div className="relative mx-auto flex h-full max-w-7xl flex-col justify-between px-4 pt-14 pb-8 md:px-8">
        <div>
          <div className="flex gap-2">
            <span className="rounded-full border border-white/30 px-3 py-1 text-xs text-fg">Featured</span>
            <span className="rounded-full border border-white/30 px-3 py-1 text-xs text-fg">{a.category === "flagship-reports" ? "Flagship Reports" : "Insight Articles"}</span>
          </div>
          <h1 className="mt-5 max-w-3xl font-display text-4xl leading-tight text-fg md:text-5xl">{a.title}</h1>
          <Link href={`/research/${a.slug}`} className="mt-6 inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-medium text-black">
            Read now <ArrowRight size={14} />
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {items.map((x, j) => (
            <button key={x.slug} onClick={() => setI(j)} className={`border-t-2 pt-3 text-left text-sm transition ${j === i ? "border-white text-fg" : "border-white/20 text-fg/50 hover:text-fg/80"}`}>
              <span className="line-clamp-2">{x.title}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
