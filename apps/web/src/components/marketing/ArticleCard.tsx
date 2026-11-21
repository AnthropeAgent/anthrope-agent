import Link from "next/link";
import type { Article } from "@/lib/data/types";
import { CoverArt } from "./CoverArt";

export function ArticleCover({ a, className = "" }: { a: Article; className?: string }) {
  return (
    <div
      className={`${className.includes("absolute") ? "" : "relative"} overflow-hidden ${className}`}
      style={{
        background: `radial-gradient(circle at 30% 30%, hsl(${a.hue} 80% 55% / 0.55), transparent 55%), radial-gradient(circle at 80% 80%, hsl(${(a.hue + 60) % 360} 80% 45% / 0.45), transparent 50%), #17120e`,
      }}
    >
      <CoverArt a={a} labels={!className.includes("absolute")} />
      {a.coverUrl?.startsWith("https://") && (
        // eslint-disable-next-line @next/next/no-img-element -- cover dari CMS bisa di domain mana saja (diisi admin)
        <img src={a.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
      )}
    </div>
  );
}

export function ArticleCard({ a, base = "/research" }: { a: Article; base?: string }) {
  return (
    <Link href={`${base}/${a.slug}`} className="group block w-[300px] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-panel md:w-[340px]">
      <ArticleCover a={a} className="aspect-[16/9] transition group-hover:scale-[1.02]" />
      <div className="p-4">
        <div className="flex flex-wrap gap-1.5">
          {a.tags.map((t) => (
            <span key={t} className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-dim">
              {t}
            </span>
          ))}
        </div>
        <h3 className="mt-3 line-clamp-2 text-[17px] leading-snug text-fg">{a.title}</h3>
        <div className="mt-3 text-xs text-muted">
          {new Date(a.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · {a.readMin} min read
        </div>
      </div>
    </Link>
  );
}
