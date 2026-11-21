/**
 * Renderer Markdown kecil untuk artikel CMS: heading (#, ##, ###), paragraf, daftar (- / 1.), kutipan (>),
 * blok kode (```), **tebal**, *miring*, `kode`, dan [tautan](https://…). Tidak pernah memakai HTML mentah,
 * jadi isi artikel tidak bisa menyisipkan script/markup. Tautan hanya http(s).
 */
import type { ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k} className="text-fg">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="rounded bg-white/10 px-1 text-[0.9em]">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) out.push(<a key={k} href={m[2]} target="_blank" rel="noreferrer noopener nofollow" className="text-primary underline">{t.slice(1, t.indexOf("]"))}</a>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `b${i}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={k} className="overflow-x-auto rounded-lg bg-white/5 p-4 text-sm"><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const cls = h[1].length === 1 ? "text-3xl" : h[1].length === 2 ? "text-2xl" : "text-xl";
      blocks.push(<h2 key={k} className={`pt-4 font-display ${cls} text-fg`}>{inline(h[2], k)}</h2>);
      i++;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""));
      const L = ordered ? "ol" : "ul";
      blocks.push(<L key={k} className={`space-y-1 pl-6 ${ordered ? "list-decimal" : "list-disc"}`}>{items.map((t, j) => <li key={j}>{inline(t, `${k}-${j}`)}</li>)}</L>);
      continue;
    }
    if (line.startsWith(">")) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) q.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={k} className="border-l-2 border-primary pl-4 text-dim">{inline(q.join(" "), k)}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|>|\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k}>{inline(para.join(" "), k)}</p>);
  }
  return <>{blocks}</>;
}
