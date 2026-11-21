/** Kerangka halaman legal (Privacy, Terms): judul, tanggal berlaku, lalu bagian bernomor. */
export function LegalPage({ title, updated, intro, sections }: { title: string; updated: string; intro: string; sections: [string, React.ReactNode][] }) {
  return (
    <article className="mx-auto max-w-3xl px-4 pt-14 pb-24 md:pt-20">
      <h1 className="font-serif text-5xl leading-tight text-fg">{title}</h1>
      <p className="mt-2 text-xs tracking-wider text-muted uppercase">Last updated {updated}</p>
      <p className="mt-6 text-[15px] leading-relaxed text-soft">{intro}</p>
      <ol className="mt-10 space-y-8">
        {sections.map(([h, body], i) => (
          <li key={h}>
            <h2 className="font-serif text-2xl text-fg">
              {i + 1}. {h}
            </h2>
            <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-dim [&_a]:text-link [&_a]:underline [&_li]:ml-5 [&_li]:list-disc">{body}</div>
          </li>
        ))}
      </ol>
    </article>
  );
}
