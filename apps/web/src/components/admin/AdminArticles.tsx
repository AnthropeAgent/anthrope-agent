"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { AccountButton } from "@/components/account/AccountButton";
import { Markdown } from "@/components/marketing/Markdown";
import { useAccount } from "@/lib/auth/account";

type Category = "blog" | "flagship-reports" | "insight-articles";
interface Row {
  id: string;
  slug: string;
  category: Category;
  title: string;
  excerpt: string;
  body: string;
  tags: string[];
  featured?: boolean;
  status: "draft" | "published";
  coverUrl?: string | null;
  author?: string | null;
  updatedAt: string;
}
interface Draft {
  id: string | null;
  slug: string;
  category: Category;
  title: string;
  excerpt: string;
  body: string;
  tags: string;
  featured: boolean;
  status: "draft" | "published";
  coverUrl: string;
  authorName: string;
}
const EMPTY: Draft = { id: null, slug: "", category: "blog", title: "", excerpt: "", body: "", tags: "", featured: false, status: "draft", coverUrl: "", authorName: "" };
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(j?.error?.message ?? `HTTP ${res.status}`), { status: res.status });
  return j as T;
}

export function AdminArticles() {
  const { me } = useAccount();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [d, setD] = useState<Draft>(EMPTY);
  const [preview, setPreview] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    call<{ items: Row[] }>("GET", "/admin/articles")
      .then((r) => {
        setRows(r.items);
        setStatus(200);
      })
      .catch((e: Error & { status?: number }) => {
        setStatus(e.status ?? 0);
        setError(e.message);
      });
  }, []);
  useEffect(() => {
    if (me) load();
  }, [me, load]);

  const edit = (r: Row) =>
    setD({ id: r.id, slug: r.slug, category: r.category, title: r.title, excerpt: r.excerpt, body: r.body, tags: r.tags.join(", "), featured: !!r.featured, status: r.status, coverUrl: r.coverUrl ?? "", authorName: r.author ?? "" });

  const save = async () => {
    setMsg(null);
    const body = {
      slug: d.slug || slugify(d.title),
      category: d.category,
      title: d.title,
      excerpt: d.excerpt,
      body: d.body,
      tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean),
      featured: d.featured,
      status: d.status,
      coverUrl: d.coverUrl.trim() || null,
      authorName: d.authorName.trim() || null,
    };
    try {
      const r = await call<Row>(d.id ? "PUT" : "POST", d.id ? `/admin/articles/${d.id}` : "/admin/articles", body);
      setMsg(d.status === "published" ? "Tersimpan dan terbit." : "Draft tersimpan.");
      edit(r);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const field = "w-full rounded-md border border-line-2 bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-primary";
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8 text-soft">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold text-fg">CMS · Research & Blog</h1>
        <div className="ml-auto">
          <AccountButton />
        </div>
      </div>
      {me === null && <p className="text-sm text-muted">Login dengan wallet admin untuk mengelola artikel.</p>}
      {me && status === 403 && (
        <p className="text-sm text-muted">
          Wallet ini bukan admin. Tambahkan alamatnya ke <code className="text-fg">ADMIN_WALLETS</code> di .env server, lalu restart api.
        </p>
      )}
      {me && status && status !== 200 && status !== 403 && <p className="text-sm text-down">{error}</p>}
      {rows && (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <aside className="space-y-1">
            <button onClick={() => setD(EMPTY)} className="flex w-full items-center gap-1.5 rounded-md border border-line-2 px-3 py-2 text-sm hover:text-fg">
              <Plus size={14} /> Artikel baru
            </button>
            {rows.map((r) => (
              <button key={r.id} onClick={() => edit(r)} className={`block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-panel-2 ${d.id === r.id ? "bg-panel-2" : ""}`}>
                <div className="truncate text-fg">{r.title}</div>
                <div className="text-[11px] text-muted">
                  {r.status === "published" ? "terbit" : "draft"} · {r.category} · {new Date(r.updatedAt).toLocaleDateString("id-ID")}
                </div>
              </button>
            ))}
            {!rows.length && <p className="px-3 text-xs text-muted">Belum ada artikel. Selama kosong, situs menampilkan artikel contoh.</p>}
          </aside>
          <section className="space-y-3 rounded-xl border border-line p-4">
            <input placeholder="Judul" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value, slug: d.id ? d.slug : slugify(e.target.value) })} className={field} />
            <div className="grid gap-3 sm:grid-cols-3">
              <input placeholder="slug" value={d.slug} onChange={(e) => setD({ ...d, slug: e.target.value })} className={field} />
              <select value={d.category} onChange={(e) => setD({ ...d, category: e.target.value as Category })} className={field}>
                <option value="blog">Blog</option>
                <option value="insight-articles">Insight article</option>
                <option value="flagship-reports">Flagship report</option>
              </select>
              <select value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as Draft["status"] })} className={field}>
                <option value="draft">Draft</option>
                <option value="published">Terbit</option>
              </select>
            </div>
            <textarea placeholder="Ringkasan (excerpt)" rows={2} value={d.excerpt} onChange={(e) => setD({ ...d, excerpt: e.target.value })} className={field} />
            <div className="grid gap-3 sm:grid-cols-3">
              <input placeholder="Tag, dipisah koma" value={d.tags} onChange={(e) => setD({ ...d, tags: e.target.value })} className={field} />
              <input placeholder="Penulis" value={d.authorName} onChange={(e) => setD({ ...d, authorName: e.target.value })} className={field} />
              <input placeholder="URL cover (https://, opsional)" value={d.coverUrl} onChange={(e) => setD({ ...d, coverUrl: e.target.value })} className={field} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={d.featured} onChange={(e) => setD({ ...d, featured: e.target.checked })} /> Tampilkan di Featured
            </label>
            <div className="flex gap-2 text-xs">
              <button onClick={() => setPreview(false)} className={`rounded px-2 py-1 ${!preview ? "bg-panel-3 text-fg" : "text-muted"}`}>
                Tulis (Markdown)
              </button>
              <button onClick={() => setPreview(true)} className={`rounded px-2 py-1 ${preview ? "bg-panel-3 text-fg" : "text-muted"}`}>
                Pratinjau
              </button>
            </div>
            {preview ? (
              <div className="min-h-[320px] space-y-4 rounded-md border border-line-2 p-4 leading-relaxed">
                <Markdown source={d.body || "_Kosong_"} />
              </div>
            ) : (
              <textarea rows={16} value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} placeholder="# Judul bagian&#10;&#10;Isi artikel…" className={`${field} font-mono`} />
            )}
            <div className="flex items-center gap-2">
              <button onClick={save} disabled={!d.title.trim()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-ink disabled:opacity-50">
                Simpan
              </button>
              {d.id && d.status === "published" && (
                <Link href={`/${d.category === "blog" ? "blog" : "research"}/${d.slug}`} target="_blank" className="text-sm text-primary underline">
                  Lihat
                </Link>
              )}
              {d.id && (
                <button
                  onClick={async () => {
                    if (!confirm(`Hapus "${d.title}"? Tidak bisa dibatalkan.`)) return;
                    await call("DELETE", `/admin/articles/${d.id}`).catch((e: Error) => setMsg(e.message));
                    setD(EMPTY);
                    load();
                  }}
                  className="ml-auto flex items-center gap-1 text-sm text-muted hover:text-down"
                >
                  <Trash2 size={14} /> Hapus
                </button>
              )}
            </div>
            {msg && <div className="text-sm text-soft">{msg}</div>}
          </section>
        </div>
      )}
    </div>
  );
}
