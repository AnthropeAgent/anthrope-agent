/**
 * Pengaturan situs (contract address token resmi).
 *   GET /api/v1/site/token        publik: { token: SiteToken | null }
 *   PUT /api/v1/admin/site/token  admin: simpan, body SiteToken atau { clear: true }
 * Admin = sama dengan CMS (users.role 'admin' atau wallet di ADMIN_WALLETS). Perubahan dicatat di audit_log.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { postgres } from "@ot/db";
import type { AuthStore } from "../auth/store";
import { originAllowed, sessionUserId } from "./account";

const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM = /^0x[0-9a-fA-F]{40}$/;

export const SiteTokenBody = z
  .object({
    chain: z.string().regex(/^[a-z0-9-]{2,24}$/),
    address: z.string().trim().min(32).max(64),
    symbol: z.string().trim().max(16).default(""),
    buyUrl: z.string().url().startsWith("https://").max(500).nullable().default(null),
  })
  .strict()
  .refine((t) => (t.chain === "solana" ? SOLANA.test(t.address) : EVM.test(t.address)), { message: "alamat tidak cocok dengan format chain", path: ["address"] });
export type SiteToken = z.infer<typeof SiteTokenBody>;

export interface SiteStore {
  available(): boolean;
  getToken(): Promise<SiteToken | null>;
  setToken(t: SiteToken | null, actorId: string, ip: string): Promise<void>;
}

function pg() {
  const p = postgres();
  if (!p) throw new Error("postgres tidak tersedia");
  return p;
}

export const pgSiteStore: SiteStore = {
  available: () => postgres() !== null,
  async getToken() {
    const { rows } = await pg().query<{ value: SiteToken }>("SELECT value FROM site_settings WHERE key = 'token'");
    return rows[0]?.value ?? null;
  },
  async setToken(t, actor, ip) {
    if (t) {
      await pg().query(
        `INSERT INTO site_settings (key, value, updated_by) VALUES ('token', $1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [JSON.stringify(t), actor],
      );
    } else {
      await pg().query("DELETE FROM site_settings WHERE key = 'token'");
    }
    await pg().query("INSERT INTO audit_log (actor_id, action, target, diff, ip) VALUES ($1, $2, 'token', $3, $4)", [
      actor,
      t ? "site.token.set" : "site.token.clear",
      JSON.stringify(t),
      ip || null,
    ]);
  },
};

export async function siteRoutes(app: FastifyInstance, opts: { site: SiteStore; auth: AuthStore; origins: string[]; adminWallets: string[] }) {
  const { site, auth, origins } = opts;
  const adminWallets = new Set(opts.adminWallets.map((w) => (w.startsWith("0x") ? w.toLowerCase() : w)));
  const err = (reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });

  app.get("/site/token", async (_req, reply) => {
    if (!site.available()) return { token: null };
    reply.header("cache-control", "public, max-age=15");
    return { token: await site.getToken() };
  });

  app.put("/admin/site/token", async (req, reply) => {
    reply.header("cache-control", "no-store");
    if (!originAllowed(req, origins)) return err(reply, 403, "FORBIDDEN_ORIGIN", "Origin tidak diizinkan");
    if (!site.available()) return err(reply, 503, "SERVICE_UNAVAILABLE", "Database tidak tersedia");
    const id = auth.available() ? await sessionUserId(req, auth) : null;
    if (!id) return err(reply, 401, "UNAUTHENTICATED", "Login dulu");
    const me = await auth.getMe(id);
    const ok = me && (me.role === "admin" || me.wallets.some((w) => adminWallets.has(w.address.startsWith("0x") ? w.address.toLowerCase() : w.address)));
    if (!ok) return err(reply, 403, "FORBIDDEN", "Hanya admin");
    if ((req.body as { clear?: unknown } | null)?.clear === true) {
      await site.setToken(null, id, req.ip);
      return { token: null };
    }
    const b = SiteTokenBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, "INVALID_BODY", b.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    await site.setToken(b.data, id, req.ip);
    return { token: b.data };
  });
}
