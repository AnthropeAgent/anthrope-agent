/**
 * Public Data API (langkah 13): API key + kuota. Billing berbayar belum dikonfigurasi (Stripe).
 *   GET    /api/v1/me/api-keys          daftar key milik user (tanpa key asli) + pemakaian bulan ini
 *   POST   /api/v1/me/api-keys {name}   buat key; key asli hanya dikembalikan SEKALI
 *   DELETE /api/v1/me/api-keys/{id}     cabut key
 *   GET    /api/v1/billing              paket & status billing
 * Request dengan header `x-api-key` ke /api/v1 divalidasi dan dihitung: 1 kredit per request,
 * batas per detik dan per bulan sesuai paket. Yang disimpan hanya sha256(key).
 */
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { postgres, redis } from "@ot/db";
import type { AuthStore } from "../auth/store";
import { originAllowed, sessionUserId } from "./account";

export const KEYS_MAX = 5;

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  plan: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
  usedThisMonth: number;
  monthlyCredits: number;
}
export interface KeyAuth {
  id: string;
  plan: string;
  monthlyCredits: number;
  rps: number;
}

export interface ApiKeyStore {
  available(): boolean;
  list(userId: string): Promise<ApiKeyInfo[]>;
  create(userId: string, name: string): Promise<{ key: string; info: ApiKeyInfo } | "full">;
  revoke(userId: string, id: string): Promise<boolean>;
  /** Cari key aktif dari hash. */
  lookup(hash: Buffer): Promise<KeyAuth | null>;
  /** Hitung 1 request. false bila melewati batas. */
  count(k: KeyAuth): Promise<{ ok: boolean; reason?: "rps" | "monthly"; used: number }>;
  touch(id: string): Promise<void>;
}

export const hashKey = (key: string) => createHash("sha256").update(key).digest();
const month = () => new Date().toISOString().slice(0, 7).replace("-", "");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function pg() {
  const p = postgres();
  if (!p) throw new Error("postgres tidak tersedia");
  return p;
}

async function used(id: string): Promise<number> {
  const r = redis();
  if (!r) return 0;
  return Number((await r.get(`apikey:used:${id}:${month()}`).catch(() => null)) ?? 0);
}

export const pgApiKeyStore: ApiKeyStore = {
  available: () => postgres() !== null && redis() !== null,
  async list(userId) {
    const { rows } = await pg().query<{ id: string; name: string; prefix: string; plan_id: string; created_at: Date; last_used_at: Date | null; revoked_at: Date | null; monthly_credits: string }>(
      `SELECT k.id, k.name, k.prefix, k.plan_id, k.created_at, k.last_used_at, k.revoked_at, p.monthly_credits
         FROM api_keys k JOIN api_plans p ON p.id = k.plan_id WHERE k.user_id = $1 ORDER BY k.created_at DESC`,
      [userId],
    );
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        name: r.name,
        prefix: r.prefix,
        plan: r.plan_id,
        createdAt: r.created_at.toISOString(),
        lastUsedAt: r.last_used_at?.toISOString() ?? null,
        revoked: !!r.revoked_at,
        usedThisMonth: await used(r.id),
        monthlyCredits: Number(r.monthly_credits),
      })),
    );
  },
  async create(userId, name) {
    const { rows: c } = await pg().query<{ n: string }>("SELECT count(*) AS n FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL", [userId]);
    if (Number(c[0].n) >= KEYS_MAX) return "full";
    const key = `ak_${randomBytes(32).toString("base64url")}`;
    const { rows } = await pg().query<{ id: string; created_at: Date }>(
      "INSERT INTO api_keys (user_id, name, prefix, key_hash, plan_id) VALUES ($1, $2, $3, $4, 'free') RETURNING id, created_at",
      [userId, name, key.slice(0, 11), hashKey(key)],
    );
    const plan = await pg().query<{ monthly_credits: string }>("SELECT monthly_credits FROM api_plans WHERE id = 'free'");
    return {
      key,
      info: { id: rows[0].id, name, prefix: key.slice(0, 11), plan: "free", createdAt: rows[0].created_at.toISOString(), lastUsedAt: null, revoked: false, usedThisMonth: 0, monthlyCredits: Number(plan.rows[0]?.monthly_credits ?? 0) },
    };
  },
  async revoke(userId, id) {
    const r = await pg().query("UPDATE api_keys SET revoked_at = now() WHERE user_id = $1 AND id = $2 AND revoked_at IS NULL", [userId, id]);
    return (r.rowCount ?? 0) > 0;
  },
  async lookup(hash) {
    const { rows } = await pg().query<{ id: string; plan_id: string; monthly_credits: string; rps_limit: number }>(
      "SELECT k.id, k.plan_id, p.monthly_credits, p.rps_limit FROM api_keys k JOIN api_plans p ON p.id = k.plan_id WHERE k.key_hash = $1 AND k.revoked_at IS NULL",
      [hash],
    );
    const r = rows[0];
    return r ? { id: r.id, plan: r.plan_id, monthlyCredits: Number(r.monthly_credits), rps: r.rps_limit } : null;
  },
  async count(k) {
    const r = redis();
    if (!r) return { ok: true, used: 0 };
    const sec = `apikey:rps:${k.id}:${Math.floor(Date.now() / 1000)}`;
    const n = await r.incr(sec);
    if (n === 1) await r.expire(sec, 2);
    if (n > k.rps) return { ok: false, reason: "rps", used: await used(k.id) };
    const mk = `apikey:used:${k.id}:${month()}`;
    const m = await r.incr(mk);
    if (m === 1) await r.expire(mk, 40 * 86_400);
    return m > k.monthlyCredits ? { ok: false, reason: "monthly", used: m } : { ok: true, used: m };
  },
  async touch(id) {
    await pg().query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [id]);
  },
};

const err = (reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });

/** Hook onRequest untuk SEMUA route /api/v1: validasi & hitung kuota request yang membawa `x-api-key`. */
export function apiKeyGuard(keys: ApiKeyStore) {
  const lookupCache = new Map<string, { k: KeyAuth | null; at: number }>();
  const touched = new Map<string, number>();

  return async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = req.headers["x-api-key"];
    if (raw === undefined) return;
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!/^ak_[A-Za-z0-9_-]{43}$/.test(key)) return err(reply, 401, "INVALID_API_KEY", "API key tidak valid");
    if (!keys.available()) return err(reply, 503, "SERVICE_UNAVAILABLE", "Validasi API key sementara tidak tersedia");
    const h = hashKey(key);
    const ck = h.toString("hex");
    let c = lookupCache.get(ck);
    if (!c || Date.now() - c.at > 30_000) {
      c = { k: await keys.lookup(h), at: Date.now() };
      lookupCache.set(ck, c);
      if (lookupCache.size > 10_000) lookupCache.clear();
    }
    if (!c.k) return err(reply, 401, "INVALID_API_KEY", "API key tidak valid atau sudah dicabut");
    const r = await keys.count(c.k);
    reply.header("x-credits-limit", String(c.k.monthlyCredits));
    reply.header("x-credits-used", String(r.used));
    if (!r.ok) {
      reply.header("retry-after", r.reason === "rps" ? "1" : "86400");
      return err(reply, 429, r.reason === "rps" ? "RATE_LIMITED" : "QUOTA_EXCEEDED", r.reason === "rps" ? `Maksimal ${c.k.rps} request/detik` : "Kredit bulan ini habis");
    }
    if (Date.now() - (touched.get(c.k.id) ?? 0) > 60_000) {
      touched.set(c.k.id, Date.now());
      void keys.touch(c.k.id).catch(() => undefined);
    }
  };
}

export async function apiKeyRoutes(app: FastifyInstance, opts: { keys: ApiKeyStore; auth: AuthStore; origins: string[]; stripeConfigured: boolean }) {
  const { keys, auth, origins } = opts;

  async function user(req: FastifyRequest, reply: FastifyReply) {
    if (!keys.available() || !auth.available()) {
      err(reply, 503, "SERVICE_UNAVAILABLE", "Layanan API key sementara tidak tersedia");
      return null;
    }
    if (req.method !== "GET" && !originAllowed(req, origins)) {
      err(reply, 403, "FORBIDDEN_ORIGIN", "Origin tidak diizinkan");
      return null;
    }
    const id = await sessionUserId(req, auth);
    if (!id) err(reply, 401, "UNAUTHENTICATED", "Login dulu");
    reply.header("cache-control", "no-store");
    return id;
  }

  app.get("/me/api-keys", async (req, reply) => {
    const u = await user(req, reply);
    if (!u) return;
    return { items: await keys.list(u), max: KEYS_MAX };
  });

  app.post("/me/api-keys", async (req, reply) => {
    const u = await user(req, reply);
    if (!u) return;
    const b = z.object({ name: z.string().trim().min(1).max(40).regex(/^[^\p{C}]+$/u) }).strict().safeParse(req.body);
    if (!b.success) return err(reply, 400, "INVALID_BODY", "Nama key 1–40 karakter");
    const r = await keys.create(u, b.data.name);
    if (r === "full") return err(reply, 409, "KEYS_FULL", `Maksimal ${KEYS_MAX} key aktif`);
    return reply.code(201).send(r);
  });

  app.delete("/me/api-keys/:id", async (req, reply) => {
    const u = await user(req, reply);
    if (!u) return;
    const id = String((req.params as { id: string }).id);
    if (!UUID.test(id)) return err(reply, 400, "INVALID_ID", "id tidak valid");
    if (!(await keys.revoke(u, id))) return err(reply, 404, "NOT_FOUND", "Key tidak ada");
    return { ok: true };
  });

  app.get("/billing", async () => ({
    configured: opts.stripeConfigured,
    message: opts.stripeConfigured ? null : "Billing berbayar belum dikonfigurasi. Semua key memakai paket Free.",
    plans: [{ id: "free", monthlyCredits: 30_000, rps: 1, priceUsd: 0, available: true }],
  }));
}
