import { notFound } from "next/navigation";
import { ArticleCover } from "./ArticleCard";
import type { Article } from "@/lib/data/types";
import { Markdown } from "./Markdown";

export function ArticleBody({ a }: { a: Article | null | undefined }) {
  if (!a) notFound();
  return (
    <article className="mx-auto max-w-3xl px-4 py-16">
      <div className="flex gap-2">
        {a.tags.map((t) => (
          <span key={t} className="rounded-full border border-white/15 px-2.5 py-0.5 text-xs text-dim">
            {t}
          </span>
        ))}
      </div>
      <h1 className="mt-5 font-display text-4xl leading-tight font-light text-fg md:text-5xl">{a.title}</h1>
      <div className="mt-4 text-sm text-muted">
        {new Date(a.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · {a.readMin} min read{a.author ? ` · ${a.author}` : ""}
      </div>
      <ArticleCover a={a} className="mt-10 aspect-[16/8] rounded-2xl" />
      <div className="mt-10 space-y-5 text-[17px] leading-relaxed text-soft">
        {a.body ? <Markdown source={a.body} /> : (
          <>
            <p>{a.excerpt}</p>
            <p className="text-sm text-muted">Artikel contoh. Tulis artikel asli di /admin (CMS) untuk menggantikan konten ini.</p>
          </>
        )}
      </div>
    </article>
  );
}
