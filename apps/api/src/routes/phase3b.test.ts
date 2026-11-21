import assert from "node:assert/strict";
import { test } from "node:test";
import type { AlertEvent, AlertRule, Me, PerpsDoc } from "@ot/types";
import { buildApp } from "../app";
import type { AuthStore } from "../auth/store";
import { hashSession } from "./account";
import type { AlertStore } from "./alerts";
import { hashKey, type ApiKeyStore, type KeyAuth } from "./apikeys";
import type { AdminArticle, CmsStore } from "./cms";
import type { MarketStore } from "./markets";

const ORIGIN = "http://localhost:3000";
const TOKEN = "A".repeat(43);
const ADMIN_TOKEN = "B".repeat(43);
const UID = "00000000-0000-0000-0000-000000000001";
const ADMIN = "00000000-0000-0000-0000-000000000002";

function auth(): AuthStore {
  const sessions = new Map([
    [hashSession(TOKEN).toString("hex"), UID],
    [hashSession(ADMIN_TOKEN).toString("hex"), ADMIN],
  ]);
  const me = (id: string, role: Me["role"]): Me => ({ id, displayName: null, email: null, role, wallets: [], preferences: {} });
  return {
    available: () => true,
    async sessionUser(h: Buffer) { return sessions.get(h.toString("hex")) ?? null; },
    async getMe(id: string) { return id === ADMIN ? me(id, "admin") : id === UID ? me(id, "user") : null; },
  } as unknown as AuthStore;
}

const marketStore = (perps: PerpsDoc | null): MarketStore => ({
  async getTrenches(c) { return c === "solana" ? { items: [], counts: { created: 1 }, updatedAt: new Date().toISOString() } : null; },
  async getPerps() { return perps; },
});

test("Markets: trenches per chain, perps pending, status sumber data", async () => {
  const app = buildApp({ marketStore: marketStore(null), authStore: auth() });
  assert.equal((await app.inject("/api/v1/trenches/base")).statusCode, 404);
  const t = (await app.inject("/api/v1/trenches/solana")).json<{ pending: boolean; counts: Record<string, number> }>();
  assert.equal(t.pending, false);
  assert.equal(t.counts.created, 1);
  assert.equal((await app.inject("/api/v1/perps")).json<{ pending: boolean }>().pending, true);
  const s = (await app.inject("/api/v1/status/data-sources")).json<{ chains: { mode: string }[] }>();
  assert.ok(s.chains.every((c) => c.mode === "A"));
  await app.close();
});

test("Alerts: wajib login, validasi, CSRF, buat lalu baca event", async () => {
  const rules: AlertRule[] = [];
  const alerts: AlertStore = {
    available: () => true,
    async list() { return rules; },
    async count() { return rules.length; },
    async create(_u, r) { const x = { ...r, id: "11111111-1111-1111-1111-111111111111", active: true, lastFiredAt: null, createdAt: new Date().toISOString() }; rules.push(x); return x; },
    async setActive() { return true; },
    async remove() { return true; },
    async events(): Promise<AlertEvent[]> { return [{ id: 1, ruleId: rules[0].id, kind: "price_above", chain: "solana", address: rules[0].address, firedAt: new Date().toISOString(), message: "x", symbol: null, value: 2, threshold: 1 }]; },
  };
  const app = buildApp({ alertStore: alerts, authStore: auth() });
  assert.equal((await app.inject("/api/v1/me/alerts")).statusCode, 401);
  const cookie = `session=${TOKEN}`;
  const body = { kind: "price_above", chain: "solana", address: "So11111111111111111111111111111111111111112", threshold: 1.5 };
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/me/alerts", headers: { cookie, origin: "https://evil.example" }, payload: body })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/me/alerts", headers: { cookie, origin: ORIGIN }, payload: { ...body, address: "bad" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/me/alerts", headers: { cookie, origin: ORIGIN }, payload: { ...body, threshold: -1 } })).statusCode, 400);
  const created = await app.inject({ method: "POST", url: "/api/v1/me/alerts", headers: { cookie, origin: ORIGIN }, payload: body });
  assert.equal(created.statusCode, 201);
  assert.equal((await app.inject({ url: "/api/v1/me/alerts", headers: { cookie } })).json<{ items: unknown[] }>().items.length, 1);
  assert.equal((await app.inject({ url: "/api/v1/me/alerts/events", headers: { cookie } })).json<{ items: AlertEvent[] }>().items[0].id, 1);
  await app.close();
});

test("CMS: publik hanya artikel terbit, admin wajib role admin", async () => {
  const saved: AdminArticle[] = [];
  const cms: CmsStore = {
    available: () => true,
    async listPublished() { return saved.filter((a) => a.status === "published"); },
    async getPublished(slug) { return saved.find((a) => a.slug === slug && a.status === "published") ?? null; },
    async listAll() { return saved; },
    async create(a) {
      const x: AdminArticle = { ...a, id: "22222222-2222-2222-2222-222222222222", date: "2026-11-21", readMin: 1, hue: 1, updatedAt: new Date().toISOString(), author: a.authorName };
      saved.push(x);
      return x;
    },
    async update() { return null; },
    async remove() { return false; },
  };
  const app = buildApp({ cmsStore: cms, authStore: auth() });
  const draft = { slug: "hello-world", category: "blog", title: "Hello world", excerpt: "e", body: "# Hi", status: "draft" };
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/admin/articles", headers: { origin: ORIGIN }, payload: draft })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/admin/articles", headers: { cookie: `session=${TOKEN}`, origin: ORIGIN }, payload: draft })).statusCode, 403);
  const admin = { cookie: `session=${ADMIN_TOKEN}`, origin: ORIGIN };
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/admin/articles", headers: admin, payload: { ...draft, slug: "Bad Slug" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/v1/admin/articles", headers: admin, payload: draft })).statusCode, 201);
  assert.equal((await app.inject("/api/v1/articles")).json<{ items: unknown[] }>().items.length, 0);
  assert.equal((await app.inject("/api/v1/articles/hello-world")).statusCode, 404);
  await app.close();
});

test("API key: format salah 401, key valid dihitung, kuota habis 429", async () => {
  const KEY = "ak_" + "x".repeat(43);
  let used = 0;
  const k: KeyAuth = { id: "k1", plan: "free", monthlyCredits: 2, rps: 100 };
  const keys: ApiKeyStore = {
    available: () => true,
    async list() { return []; },
    async create() { return "full"; },
    async revoke() { return false; },
    async lookup(h) { return h.equals(hashKey(KEY)) ? k : null; },
    async count() { used++; return used > k.monthlyCredits ? { ok: false, reason: "monthly", used } : { ok: true, used }; },
    async touch() {},
  };
  const app = buildApp({ apiKeyStore: keys, marketStore: marketStore(null), authStore: auth() });
  assert.equal((await app.inject({ url: "/api/v1/perps", headers: { "x-api-key": "nope" } })).statusCode, 401);
  assert.equal((await app.inject({ url: "/api/v1/perps", headers: { "x-api-key": "ak_" + "y".repeat(43) } })).statusCode, 401);
  const ok = await app.inject({ url: "/api/v1/perps", headers: { "x-api-key": KEY } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers["x-credits-used"], "1");
  await app.inject({ url: "/api/v1/perps", headers: { "x-api-key": KEY } });
  assert.equal((await app.inject({ url: "/api/v1/perps", headers: { "x-api-key": KEY } })).statusCode, 429);
  assert.equal((await app.inject("/api/v1/perps")).statusCode, 200); // tanpa key: web app sendiri
  assert.equal((await app.inject("/api/v1/billing")).json<{ configured: boolean }>().configured, false);
  await app.close();
});
