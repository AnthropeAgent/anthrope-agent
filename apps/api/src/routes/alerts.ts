/**
 * Alerts (langkah 11). Perlu login (cookie sesi). Worker `alerts` mengevaluasi rule aktif dan menulis alert_events.
 *   GET    /api/v1/me/alerts             rule milik user
 *   POST   /api/v1/me/alerts             {kind, chain, address, threshold, cooldownSec?}
 *   PATCH  /api/v1/me/alerts/{id}        {active}
 *   DELETE /api/v1/me/alerts/{id}
 *   GET    /api/v1/me/alerts/events?after=ID   notifikasi terbaru (in-app; browser bisa menampilkan Notification)
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { isBridgeChain, isValidAddress, normAddress } from "@ot/bridge";
import { postgres } from "@ot/db";
import type { AlertEvent, AlertKind, AlertRule } from "@ot/types";
import type { AuthStore } from "../auth/store";
import { originAllowed, sessionUserId } from "./account";
import type { TokenStore } from "./tokens";

export const ALERTS_MAX = 50;

export interface AlertStore {
  available(): boolean;
  list(userId: string): Promise<AlertRule[]>;
  count(userId: string): Promise<number>;
  create(userId: string, r: Omit<AlertRule, "id" | "active" | "lastFiredAt" | "createdAt">): Promise<AlertRule>;
  setActive(userId: string, id: string, active: boolean): Promise<boolean>;
  remove(userId: string, id: string): Promise<boolean>;
  events(userId: string, afterId: number, limit: number): Promise<AlertEvent[]>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface RuleRow {
  id: string;
  kind: AlertKind;
  chain_id: string;
  target: string;
  symbol: string | null;
  params: { threshold?: number };
  channels: string[];
  cooldown_sec: number;
  active: boolean;
  last_fired_at: Date | null;
  created_at: Date;
}
const toRule = (r: RuleRow): AlertRule => ({
  id: r.id,
  kind: r.kind,
  chain: r.chain_id,
  address: r.target,
  symbol: r.symbol,
  threshold: Number(r.params?.threshold ?? 0),
  channels: r.channels,
  cooldownSec: r.cooldown_sec,
  active: r.active,
  lastFiredAt: r.last_fired_at?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
});
const COLS = "id, kind::text AS kind, chain_id, target, symbol, params, channels, cooldown_sec, active, last_fired_at, created_at";

function pg() {
  const p = postgres();
  if (!p) throw new Error("postgres tidak tersedia");
  return p;
}

export const pgAlertStore: AlertStore = {
  available: () => postgres() !== null,
  async list(userId) {
    const { rows } = await pg().query<RuleRow>(`SELECT ${COLS} FROM alert_rules WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
    return rows.map(toRule);
  },
  async count(userId) {
    const { rows } = await pg().query<{ n: string }>("SELECT count(*) AS n FROM alert_rules WHERE user_id = $1", [userId]);
    return Number(rows[0].n);
  },
  async create(userId, r) {
    const { rows } = await pg().query<RuleRow>(
      `INSERT INTO alert_rules (user_id, kind, chain_id, target, symbol, params, channels, cooldown_sec)
       VALUES ($1, $2::alert_kind, $3, $4, $5, $6, $7, $8) RETURNING ${COLS}`,
      [userId, r.kind, r.chain, r.address, r.symbol, JSON.stringify({ threshold: r.threshold }), r.channels, r.cooldownSec],
    );
    return toRule(rows[0]);
  },
  async setActive(userId, id, active) {
    const r = await pg().query("UPDATE alert_rules SET active = $3 WHERE user_id = $1 AND id = $2", [userId, id, active]);
    return (r.rowCount ?? 0) > 0;
  },
  async remove(userId, id) {
    const r = await pg().query("DELETE FROM alert_rules WHERE user_id = $1 AND id = $2", [userId, id]);
    return (r.rowCount ?? 0) > 0;
  },
  async events(userId, afterId, limit) {
    const { rows } = await pg().query<{ id: string; rule_id: string; kind: AlertKind; chain_id: string; target: string; fired_at: Date; payload: Record<string, unknown> }>(
      `SELECT e.id, e.rule_id, r.kind::text AS kind, r.chain_id, r.target, e.fired_at, e.payload
         FROM alert_events e JOIN alert_rules r ON r.id = e.rule_id
        WHERE r.user_id = $1 AND e.id > $2 ORDER BY e.id DESC LIMIT $3`,
      [userId, afterId, limit],
    );
    return rows.map((e) => ({
      id: Number(e.id),
      ruleId: e.rule_id,
      kind: e.kind,
      chain: e.chain_id,
      address: e.target,
      firedAt: e.fired_at.toISOString(),
      message: String(e.payload.message ?? ""),
      symbol: (e.payload.symbol as string | null) ?? null,
      value: Number(e.payload.value ?? 0),
      threshold: Number(e.payload.threshold ?? 0),
    }));
  },
};

const CreateBody = z
  .object({
    kind: z.enum(["price_above", "price_below", "pct_change"]),
    chain: z.string().max(20),
    address: z.string().max(100),
    threshold: z.number().positive().max(1e12),
    cooldownSec: z.number().int().min(60).max(86_400).default(900),
  })
  .strict();

export async function alertRoutes(app: FastifyInstance, opts: { alerts: AlertStore; auth: AuthStore; tokens: TokenStore; origins: string[] }) {
  const { alerts, auth, tokens, origins } = opts;
  const err = (reply: FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });

  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.includes("/me/alerts")) return;
    reply.header("cache-control", "no-store");
    if (req.method !== "GET" && !originAllowed(req, origins)) return err(reply, 403, "FORBIDDEN_ORIGIN", "Origin tidak diizinkan");
    if (!alerts.available() || !auth.available()) return err(reply, 503, "SERVICE_UNAVAILABLE", "Alerts sementara tidak tersedia");
  });

  async function user(req: Parameters<typeof sessionUserId>[0], reply: FastifyReply) {
    const id = await sessionUserId(req, auth);
    if (!id) err(reply, 401, "UNAUTHENTICATED", "Login dulu untuk memakai alerts");
    return id;
  }

  app.get("/me/alerts", async (req, reply) => {
    const u = await user(req, reply);
    if (!u) return;
    return { items: await alerts.list(u), max: ALERTS_MAX };
  });

  app.post("/me/alerts", async (req, reply) => {
    const u = await user(req, reply);
    if (!u) return;
    const b = CreateBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, "INVALID_BODY", b.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const { kind, chain, threshold, cooldownSec } = b.data;
    if (!isBridgeChain(chain) || !isValidAddress(chain, b.data.address)) return err(reply, 400, "INVALID_TOKEN", "Token tidak valid");
    if (kind === "pct_change" && threshold > 1000) return err(reply, 400, "INVALID_THRESHOLD", "Persen maksimal 1000");
    if ((await alerts.count(u)) >= ALERTS_MAX) return err(reply, 409, "ALERTS_FULL", `Maksimal ${ALERTS_MAX} alert`);
    const address = normAddress(chain, b.data.address);
    const t = await tokens.getToken(chain, address).catch(() => null);
    const rule = await alerts.create(u, { kind, chain, address, symbol: t?.symbol ?? null, threshold, channels: ["web"], cooldownSec });
    return reply.code(201).send(rule);
  });

  app.patch("/me/alerts/:id", async (req, reply) => {
    const u = await user(req, reply);
    if (!u) return;
    const id = String((req.params as { id: string }).id);
    const b = z.object({ active: z.boolean() }).strict().safeParse(req.body);
    if (!UUID.test(id) || !b.success) return err(reply, 400, "INVALID_BODY", "id atau body tidak valid");
    if (!(await alerts.setActive(u, id, b.data.active))) return err(reply, 404, "NOT_FOUND", "Alert tidak ada");
    return { ok: true };
  });

  app.delete("/me/alerts/:id", async (req, reply) => {
    const u = await user(req, reply);
    if (!u) return;
    const id = String((req.params as { id: string }).id);
    if (!UUID.test(id)) return err(reply, 400, "INVALID_ID", "id tidak valid");
    if (!(await alerts.remove(u, id))) return err(reply, 404, "NOT_FOUND", "Alert tidak ada");
    return { ok: true };
  });

  app.get("/me/alerts/events", async (req, reply) => {
    const u = await user(req, reply);
    if (!u) return;
    const q = z.object({ after: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(req.query);
    if (!q.success) return err(reply, 400, "INVALID_QUERY", "query tidak valid");
    return { items: await alerts.events(u, q.data.after, q.data.limit) };
  });
}
