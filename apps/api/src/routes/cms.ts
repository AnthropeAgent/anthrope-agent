/**
 * CMS Research & Blog (langkah 12).
 *   GET    /api/v1/articles?category=&limit=     artikel terbit (publik)
 *   GET    /api/v1/articles/{slug}               satu artikel terbit (dengan isi)
 *   GET    /api/v1/admin/articles                semua artikel, termasuk draft (admin)
 *   POST   /api/v1/admin/articles                buat
 *   PUT    /api/v1/admin/articles/{id}           ubah
 *   DELETE /api/v1/admin/articles/{id}           hapus
 * Admin = users.role 'admin' ATAU salah satu wallet user ada di ADMIN_WALLETS. Semua perubahan dicatat di audit_log.
 * Isi artikel disimpan sebagai Markdown teks; web merendernya tanpa HTML mentah.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { postgres } from "@ot/db";
import type { Article } from "@ot/types";
import type { AuthStore } from "../auth/store";
import { originAllowed, sessionUserId } from "./account";

export type ArticleInput = z.infer<typeof ArticleBody>;
export interface AdminArticle extends Article {
  id: string;
  status: "draft" | "published";
  body: string;
  updatedAt: string;
}

export interface CmsStore {
  available(): boolean;
  listPublished(category: Article["category"] | undefined, limit: number): Promise<Article[]>;
  getPublished(slug: string): Promise<Article | null>;
  listAll(): Promise<AdminArticle[]>;
  create(a: ArticleInput, actorId: string, ip: string): Promise<AdminArticle>;
  update(id: string, a: ArticleInput, actorId: string, ip: string): Promise<AdminArticle | null>;
  remove(id: string, actorId: string, ip: string): Promise<boolean>;
}

const CATEGORY = z.enum(["blog", "flagship-reports", "insight-articles"]);
const ArticleBody = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "huruf kecil, angka, dan tanda hubung").max(120),
    category: CATEGORY,
    title: z.string().trim().min(3).max(200),
    excerpt: z.string().trim().max(500),
    body: z.string().max(200_000),
    tags: z.array(z.string().trim().min(1).max(32)).max(12).default([]),
    featured: z.boolean().default(false),
    status: z.enum(["draft", "published"]).default("draft"),
    coverUrl: z.string().url().startsWith("https://").max(500).nullable().default(null),
    authorName: z.string().trim().max(80).nullable().default(null),
  })
  .strict();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Row {
  id: string;
  slug: string;
  category: Article["category"];
  title: string;
  excerpt: string;
  body_md: string;
  cover_url: string | null;
  tags: string[];
  featured: boolean;
  read_minutes: number | null;
  status: "draft" | "published";
  author_name: string | null;
  published_at: Date | null;
  updated_at: Date;
}
const COLS = "id, slug, category::text AS category, title, excerpt, body_md, cover_url, tags, featured, read_minutes, status, author_name, published_at, updated_at";

/** Warna cover default yang stabil per slug (tanpa gambar). */
const hueOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const readMinutes = (body: string) => Math.max(1, Math.round(body.split(/\s+/).filter(Boolean).length / 220));

function toArticle(r: Row, withBody: boolean): Article {
  return {
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    category: r.category,
    tags: r.tags,
    date: (r.published_at ?? r.updated_at).toISOString().slice(0, 10),
    readMin: r.read_minutes ?? readMinutes(r.body_md),
    hue: hueOf(r.slug),
    featured: r.featured,
    coverUrl: r.cover_url,
    author: r.author_name,
    ...(withBody ? { body: r.body_md } : {}),
  };
}
const toAdmin = (r: Row): AdminArticle => ({ ...toArticle(r, true), id: r.id, status: r.status, body: r.body_md, updatedAt: r.updated_at.toISOString() });

function pg() {
  const p = postgres();
  if (!p) throw new Error("postgres tidak tersedia");
  return p;
}
async function audit(actor: string, action: string, target: string, diff: unknown, ip: string) {
  await pg().query("INSERT INTO audit_log (actor_id, action, target, diff, ip) VALUES ($1, $2, $3, $4, $5)", [actor, action, target, JSON.stringify(diff), ip || null]);
}

export const pgCmsStore: CmsStore = {
  available: () => postgres() !== null,
  async listPublished(category, limit) {
    const { rows } = await pg().query<Row>(
      `SELECT ${COLS} FROM articles WHERE status = 'published' AND ($1::text IS NULL OR category::text = $1) ORDER BY published_at DESC NULLS LAST LIMIT $2`,
      [category ?? null, limit],
    );
    return rows.map((r) => toArticle(r, false));
  },
  async getPublished(slug) {
    const { rows } = await pg().query<Row>(`SELECT ${COLS} FROM articles WHERE status = 'published' AND slug = $1`, [slug]);
    return rows[0] ? toArticle(rows[0], true) : null;
  },
  async listAll() {
    const { rows } = await pg().query<Row>(`SELECT ${COLS} FROM articles ORDER BY updated_at DESC LIMIT 500`);
    return rows.map(toAdmin);
  },
  async create(a, actor, ip) {
    const { rows } = await pg().query<Row>(
      `INSERT INTO articles (slug, category, title, excerpt, body_md, cover_url, tags, featured, read_minutes, status, author_id, author_name, published_at)
       VALUES ($1, $2::article_category, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CASE WHEN $10 = 'published' THEN now() END) RETURNING ${COLS}`,
      [a.slug, a.category, a.title, a.excerpt, a.body, a.coverUrl, a.tags, a.featured, readMinutes(a.body), a.status, actor, a.authorName],
    );
    await audit(actor, "article.create", a.slug, { status: a.status }, ip);
    return toAdmin(rows[0]);
  },
  async update(id, a, actor, ip) {
    const { rows } = await pg().query<Row>(
      `UPDATE articles SET slug = $2, category = $3::article_category, title = $4, excerpt = $5, body_md = $6, cover_url = $7, tags = $8, featured = $9,
              read_minutes = $10, status = $11, author_name = $12, updated_at = now(),
              published_at = CASE WHEN $11 = 'published' THEN COALESCE(published_at, now()) ELSE NULL END
        WHERE id = $1 RETURNING ${COLS}`,
      [id, a.slug, a.category, a.title, a.excerpt, a.body, a.coverUrl, a.tags, a.featured, readMinutes(a.body), a.status, a.authorName],
    );
    if (!rows[0]) return null;
    await audit(actor, a.status === "published" ? "article.publish" : "article.update", a.slug, { status: a.status }, ip);
    return toAdmin(rows[0]);
  },
  async remove(id, actor, ip) {
    const r = await pg().query<{ slug: string }>("DELETE FROM articles WHERE id = $1 RETURNING slug", [id]);
    if (!r.rows[0]) return false;
    await audit(actor, "article.delete", r.rows[0].slug, null, ip);
    return true;
  },
};

export async function cmsRoutes(app: FastifyInstance, opts: { cms: CmsStore; auth: AuthStore; origins: string[]; adminWallets: string[] }) {
  const { cms, auth, origins } = opts;
  const adminWallets = new Set(opts.adminWallets.map((w) => (w.startsWith("0x") ? w.toLowerCase() : w)));
  const err = (reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });

  app.addHook("onRequest", async (req, reply) => {
    const isCms = req.url.includes("/articles");
    if (!isCms) return;
    if (!cms.available()) return err(reply, 503, "SERVICE_UNAVAILABLE", "CMS sementara tidak tersedia");
    if (req.url.includes("/admin/")) {
      reply.header("cache-control", "no-store");
      if (req.method !== "GET" && !originAllowed(req, origins)) return err(reply, 403, "FORBIDDEN_ORIGIN", "Origin tidak diizinkan");
    }
  });

  async function admin(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const id = auth.available() ? await sessionUserId(req, auth) : null;
    if (!id) {
      err(reply, 401, "UNAUTHENTICATED", "Login dulu");
      return null;
    }
    const me = await auth.getMe(id);
    const ok = me && (me.role === "admin" || me.wallets.some((w) => adminWallets.has(w.address.startsWith("0x") ? w.address.toLowerCase() : w.address)));
    if (!ok) {
      err(reply, 403, "FORBIDDEN", "Hanya admin");
      return null;
    }
    return id;
  }

  app.get("/articles", async (req, reply) => {
    const q = z.object({ category: CATEGORY.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(req.query);
    if (!q.success) return err(reply, 400, "INVALID_QUERY", "query tidak valid");
    reply.header("cache-control", "public, max-age=30");
    return { items: await cms.listPublished(q.data.category, q.data.limit) };
  });

  app.get("/articles/:slug", async (req, reply) => {
    const slug = String((req.params as { slug: string }).slug);
    if (!/^[a-z0-9-]{1,120}$/.test(slug)) return err(reply, 400, "INVALID_SLUG", "slug tidak valid");
    const a = await cms.getPublished(slug);
    if (!a) return err(reply, 404, "NOT_FOUND", "Artikel tidak ada");
    reply.header("cache-control", "public, max-age=30");
    return a;
  });

  app.get("/admin/articles", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return { items: await cms.listAll() };
  });

  const save = async (req: FastifyRequest, reply: FastifyReply, id: string | null) => {
    const actor = await admin(req, reply);
    if (!actor) return;
    const b = ArticleBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, "INVALID_BODY", b.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    try {
      if (id === null) return reply.code(201).send(await cms.create(b.data, actor, req.ip));
      const a = await cms.update(id, b.data, actor, req.ip);
      return a ?? err(reply, 404, "NOT_FOUND", "Artikel tidak ada");
    } catch (e) {
      if ((e as { code?: string }).code === "23505") return err(reply, 409, "SLUG_TAKEN", "Slug sudah dipakai");
      throw e;
    }
  };
  app.post("/admin/articles", (req, reply) => save(req, reply, null));
  app.put("/admin/articles/:id", (req, reply) => {
    const id = String((req.params as { id: string }).id);
    if (!UUID.test(id)) return err(reply, 400, "INVALID_ID", "id tidak valid");
    return save(req, reply, id);
  });
  app.delete("/admin/articles/:id", async (req, reply) => {
    const actor = await admin(req, reply);
    if (!actor) return;
    const id = String((req.params as { id: string }).id);
    if (!UUID.test(id)) return err(reply, 400, "INVALID_ID", "id tidak valid");
    if (!(await cms.remove(id, actor, req.ip))) return err(reply, 404, "NOT_FOUND", "Artikel tidak ada");
    return { ok: true };
  });
}
