/**
 * Akun (langkah 5, ARCHITECTURE §4.13):
 *
 * POST   /api/v1/auth/nonce      pesan SIWS/SIWE untuk ditandatangani (nonce sekali pakai, 5 menit)
 * POST   /api/v1/auth/verify     cek tanda tangan → sesi baru (cookie HttpOnly, dirotasi tiap login)
 * POST   /api/v1/auth/logout
 * GET    /api/v1/me              profil, wallet, preferensi
 * PATCH  /api/v1/me              ubah nama tampilan / preferensi (whitelist)
 * GET    /api/v1/me/watchlist
 * POST   /api/v1/me/watchlist
 * DELETE /api/v1/me/watchlist/{kind}/{chain}/{address}
 *
 * Keamanan: cookie `session` HttpOnly + SameSite=Lax (+ Secure di https), yang disimpan di DB hanya sha256-nya.
 * Request yang mengubah data ditolak bila Origin bukan domain ini atau Sec-Fetch-Site = cross-site (CSRF).
 */
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { isBridgeChain, isValidAddress, normAddress, StoreUnavailableError } from "@ot/bridge";
import type { ApiError, AuthNonce, WatchlistItem } from "@ot/types";
import { buildMessage, isWalletAddress, NONCE_TTL_SEC, nonceOf, normWallet, verifySignature } from "../auth/siwx";
import { AuthUnavailableError, type AuthStore } from "../auth/store";
import { withStale, type TokenStore } from "./tokens";

export const SESSION_COOKIE = "session";
export const SESSION_TTL_SEC = 30 * 24 * 3600;
export const WATCHLIST_MAX = 200;
const RATE = { nonce: 30, verify: 30, windowSec: 300 };

export interface AccountOptions {
  auth: AuthStore;
  tokens: TokenStore;
  /** Origin aplikasi yang sah, mis. ["http://localhost:3000"]. Yang pertama dipakai di pesan SIWx. */
  origins: string[];
  appName: string;
}

const NonceBody = z.object({
  chainKind: z.enum(["solana", "evm"]),
  address: z.string().max(64),
  chainId: z.coerce.number().int().positive().max(2 ** 31).optional(),
});
const VerifyBody = z.object({ message: z.string().max(2000), signature: z.string().max(200) });
const Prefs = z
  .object({
    discoverColumns: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/)).max(40).optional(),
    chartInterval: z.enum(["1s", "5s", "1m", "5m", "15m", "1h", "4h", "1d"]).optional(),
  })
  .strict();
const MeBody = z
  .object({
    displayName: z.string().trim().min(1).max(32).regex(/^[^\p{C}]+$/u, "karakter tidak valid").nullable().optional(),
    preferences: Prefs.optional(),
  })
  .strict();
const WatchBody = z.object({
  kind: z.enum(["token", "wallet"]),
  chain: z.string().max(20),
  address: z.string().max(100),
  note: z.string().trim().max(200).regex(/^[^\p{Cc}]*$/u).optional(),
});

function err(reply: FastifyReply, status: number, code: string, message: string) {
  const body: ApiError = { error: { code, message } };
  return reply.code(status).send(body);
}
const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");

export const hashSession = (token: string) => createHash("sha256").update(token).digest();

export function readCookie(req: FastifyRequest, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim();
      return /^[A-Za-z0-9_-]{43}$/.test(v) ? v : null; // 32 byte base64url
    }
  }
  return null;
}

/** CSRF: browser selalu mengirim Origin/Sec-Fetch-Site pada fetch POST/PATCH/DELETE. */
export function originAllowed(req: FastifyRequest, origins: string[]): boolean {
  const o = req.headers.origin;
  return !((o && !origins.includes(o)) || req.headers["sec-fetch-site"] === "cross-site");
}

/** ID user dari cookie sesi (null bila tidak login / DB tidak ada). */
export async function sessionUserId(req: FastifyRequest, auth: AuthStore): Promise<string | null> {
  const token = readCookie(req, SESSION_COOKIE);
  return token && auth.available() ? auth.sessionUser(hashSession(token)) : null;
}

export async function accountRoutes(app: FastifyInstance, opts: AccountOptions) {
  const { auth, tokens, origins, appName } = opts;
  const origin = new URL(origins[0]);
  const secure = origin.protocol === "https:";

  const setSessionCookie = (reply: FastifyReply, token: string, maxAge: number) =>
    reply.header("set-cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`);

  app.addHook("onRequest", async (req, reply) => {
    reply.header("cache-control", "no-store");
    if (req.method === "GET" || req.method === "HEAD") return;
    if (!originAllowed(req, origins)) return err(reply, 403, "FORBIDDEN_ORIGIN", "Origin tidak diizinkan");
    if (!auth.available()) return err(reply, 503, "SERVICE_UNAVAILABLE", "Layanan akun sementara tidak tersedia");
  });

  /** User dari cookie sesi; membalas 401 dan mengembalikan null bila tidak login. */
  async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const userId = await sessionUserId(req, auth);
    if (!userId) {
      err(reply, 401, "UNAUTHENTICATED", "Belum login");
      return null;
    }
    return userId;
  }

  app.post("/auth/nonce", async (req, reply) => {
    const b = NonceBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, "INVALID_BODY", issues(b.error));
    const { chainKind, address, chainId } = b.data;
    if (!isWalletAddress(chainKind, address)) return err(reply, 400, "INVALID_ADDRESS", "Alamat wallet tidak valid");
    if (!(await auth.hit(`nonce:${req.ip}`, RATE.nonce, RATE.windowSec))) return err(reply, 429, "RATE_LIMITED", "Terlalu banyak percobaan login, coba lagi nanti");

    const nonce = randomBytes(16).toString("hex");
    const issuedAt = new Date();
    const message = buildMessage({ kind: chainKind, address, domain: origin.host, uri: origin.origin, appName, nonce, evmChainId: chainId, issuedAt });
    await auth.putNonce(nonce, { kind: chainKind, address: normWallet(chainKind, address), message }, NONCE_TTL_SEC);
    const res: AuthNonce = { message, nonce, expiresAt: new Date(issuedAt.getTime() + NONCE_TTL_SEC * 1000).toISOString() };
    return res;
  });

  app.post("/auth/verify", async (req, reply) => {
    const b = VerifyBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, "INVALID_BODY", issues(b.error));
    if (!(await auth.hit(`verify:${req.ip}`, RATE.verify, RATE.windowSec))) return err(reply, 429, "RATE_LIMITED", "Terlalu banyak percobaan login, coba lagi nanti");
    const { message, signature } = b.data;
    const nonce = nonceOf(message);
    // Nonce dihapus saat diambil: gagal pun harus minta pesan baru (tidak bisa ditebak berulang).
    const data = nonce ? await auth.takeNonce(nonce) : null;
    if (!data || data.message !== message) return err(reply, 401, "NONCE_INVALID", "Pesan login kedaluwarsa atau sudah dipakai; ulangi login");
    if (!verifySignature(data.kind, data.address, message, signature)) return err(reply, 401, "INVALID_SIGNATURE", "Tanda tangan tidak valid");

    const userId = await auth.loginWallet(data.kind, data.address);
    // Rotasi sesi: sesi lama di browser ini (bila ada) dihapus, selalu buat ID baru.
    const old = readCookie(req, SESSION_COOKIE);
    if (old) await auth.deleteSession(hashSession(old));
    const token = randomBytes(32).toString("base64url");
    await auth.createSession(userId, hashSession(token), new Date(Date.now() + SESSION_TTL_SEC * 1000), {
      ip: req.ip ?? null,
      userAgent: req.headers["user-agent"]?.slice(0, 200) ?? null,
    });
    setSessionCookie(reply, token, SESSION_TTL_SEC);
    req.log.info({ userId, kind: data.kind }, "login");
    return auth.getMe(userId);
  });

  app.post("/auth/logout", async (req, reply) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await auth.deleteSession(hashSession(token));
    setSessionCookie(reply, "", 0);
    return reply.code(204).send();
  });

  app.get("/me", async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return reply;
    const me = await auth.getMe(userId);
    return me ?? err(reply, 401, "UNAUTHENTICATED", "Belum login");
  });

  app.patch("/me", async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return reply;
    const b = MeBody.safeParse(req.body ?? {});
    if (!b.success) return err(reply, 400, "INVALID_BODY", issues(b.error));
    return auth.patchMe(userId, b.data);
  });

  app.get("/me/watchlist", async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return reply;
    const items = await auth.listWatchlist(userId);
    const keys = items.filter((i) => i.kind === "token").map((i) => `${i.chain}:${i.address}`);
    const snap = new Map<string, NonNullable<WatchlistItem["token"]>>();
    try {
      const now = Date.now();
      for (const t of await tokens.getTokens(keys)) snap.set(`${t.chain}:${t.address}`, withStale(t, now));
    } catch (e) {
      if (!(e instanceof StoreUnavailableError)) throw e; // tanpa data pasar, daftar tetap dikirim
    }
    return { items: items.map((i) => (i.kind === "token" ? { ...i, token: snap.get(`${i.chain}:${i.address}`) ?? null } : i)) };
  });

  app.post("/me/watchlist", async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return reply;
    const b = WatchBody.safeParse(req.body);
    if (!b.success) return err(reply, 400, "INVALID_BODY", issues(b.error));
    const { kind, chain, note } = b.data;
    if (!isBridgeChain(chain)) return err(reply, 400, "CHAIN_NOT_SUPPORTED", `Chain ${chain} belum didukung`);
    if (!isValidAddress(chain, b.data.address)) return err(reply, 400, "INVALID_ADDRESS", `Alamat tidak valid untuk ${chain}`);
    const address = normAddress(chain, b.data.address);
    const r = await auth.addWatch(userId, { kind, chain, address, note: note || null }, WATCHLIST_MAX);
    if (r === "full") return err(reply, 409, "WATCHLIST_FULL", `Watchlist maksimal ${WATCHLIST_MAX} item`);
    if (kind === "token") await tokens.requestToken(chain, address).catch(() => {});
    return reply.code(201).send({ kind, chain, address, note: note || null });
  });

  app.delete("/me/watchlist/:kind/:chain/:address", async (req, reply) => {
    const userId = await requireUser(req, reply);
    if (!userId) return reply;
    const p = z.object({ kind: z.enum(["token", "wallet"]), chain: z.string().max(20), address: z.string().max(100) }).safeParse(req.params);
    if (!p.success || !isBridgeChain(p.data.chain)) return err(reply, 400, "INVALID_PARAMS", "Parameter tidak valid");
    await auth.removeWatch(userId, p.data.kind, p.data.chain, normAddress(p.data.chain, p.data.address));
    return reply.code(204).send();
  });

  app.setErrorHandler((e, _req, reply) => {
    if (e instanceof AuthUnavailableError) return err(reply, 503, "SERVICE_UNAVAILABLE", "Layanan akun sementara tidak tersedia");
    throw e;
  });
}
