/**
 * Penyimpanan akun: Postgres (users, user_wallets, sessions, watchlist_items) + Redis (nonce, rate limit).
 * Dipisah sebagai interface supaya route bisa dites dengan versi in-memory.
 */
import { postgres, redis } from "@ot/db";
import type { ChainKind, Me, UserPreferences, UserRole, WatchlistItem } from "@ot/types";

export interface NonceData {
  kind: ChainKind;
  address: string;
  message: string;
}

export interface SessionInfo {
  ip: string | null;
  userAgent: string | null;
}

export interface MePatch {
  displayName?: string | null;
  preferences?: UserPreferences;
}

export interface AuthStore {
  /** false bila DB tidak tersedia (route auth membalas 503). */
  available(): boolean;
  putNonce(nonce: string, data: NonceData, ttlSec: number): Promise<void>;
  /** Ambil dan hapus nonce (sekali pakai). null bila tidak ada, kedaluwarsa, atau sudah dipakai. */
  takeNonce(nonce: string): Promise<NonceData | null>;
  /** Rate limit sederhana: true bila masih boleh. */
  hit(key: string, limit: number, windowSec: number): Promise<boolean>;
  /** User pemilik wallet (dibuat bila belum ada); mencatat last_login_at. */
  loginWallet(kind: ChainKind, address: string): Promise<string>;
  createSession(userId: string, idHash: Buffer, expiresAt: Date, info: SessionInfo): Promise<void>;
  deleteSession(idHash: Buffer): Promise<void>;
  sessionUser(idHash: Buffer): Promise<string | null>;
  getMe(userId: string): Promise<Me | null>;
  patchMe(userId: string, patch: MePatch): Promise<Me | null>;
  listWatchlist(userId: string): Promise<WatchlistItem[]>;
  /** "full" bila watchlist sudah mencapai batas. Item yang sudah ada dianggap berhasil. */
  addWatch(userId: string, item: WatchlistItem, max: number): Promise<"ok" | "full">;
  removeWatch(userId: string, kind: string, chain: string, address: string): Promise<void>;
}

export class AuthUnavailableError extends Error {
  constructor() {
    super("database akun tidak tersedia");
  }
}

function pg() {
  const p = postgres();
  if (!p) throw new AuthUnavailableError();
  return p;
}
function rd() {
  const r = redis();
  if (!r) throw new AuthUnavailableError();
  return r;
}

const NONCE_KEY = (n: string) => `auth:nonce:${n}`;

export const pgAuthStore: AuthStore = {
  available: () => postgres() !== null && redis() !== null,

  async putNonce(nonce, data, ttlSec) {
    await rd().set(NONCE_KEY(nonce), JSON.stringify(data), "EX", ttlSec);
  },

  async takeNonce(nonce) {
    const r = rd();
    const raw = await r.get(NONCE_KEY(nonce));
    // DEL mengembalikan 1 hanya untuk satu pemanggil: dua verify bersamaan tidak bisa sama-sama lolos.
    if (!raw || (await r.del(NONCE_KEY(nonce))) !== 1) return null;
    return JSON.parse(raw) as NonceData;
  },

  async hit(key, limit, windowSec) {
    const r = rd();
    const k = `rl:${key}`;
    const n = await r.incr(k);
    if (n === 1) await r.expire(k, windowSec);
    return n <= limit;
  },

  async loginWallet(kind, address) {
    const client = await pg().connect();
    try {
      await client.query("BEGIN");
      let { rows } = await client.query<{ user_id: string }>("SELECT user_id FROM user_wallets WHERE chain_kind = $1 AND address = $2", [kind, address]);
      if (!rows.length) {
        const u = await client.query<{ id: string }>("INSERT INTO users DEFAULT VALUES RETURNING id");
        rows = (
          await client.query<{ user_id: string }>(
            "INSERT INTO user_wallets (user_id, chain_kind, address) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING user_id",
            [u.rows[0].id, kind, address],
          )
        ).rows;
        if (!rows.length) {
          // login pertama bersamaan dari wallet yang sama: pakai user yang menang
          await client.query("DELETE FROM users WHERE id = $1", [u.rows[0].id]);
          rows = (await client.query<{ user_id: string }>("SELECT user_id FROM user_wallets WHERE chain_kind = $1 AND address = $2", [kind, address])).rows;
        }
      }
      await client.query("UPDATE users SET last_login_at = now() WHERE id = $1", [rows[0].user_id]);
      await client.query("COMMIT");
      return rows[0].user_id;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  },

  async createSession(userId, idHash, expiresAt, info) {
    await pg().query("INSERT INTO sessions (id_hash, user_id, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5)", [
      idHash,
      userId,
      expiresAt,
      info.ip,
      info.userAgent,
    ]);
  },

  async deleteSession(idHash) {
    await pg().query("DELETE FROM sessions WHERE id_hash = $1", [idHash]);
  },

  async sessionUser(idHash) {
    const { rows } = await pg().query<{ user_id: string }>("SELECT user_id FROM sessions WHERE id_hash = $1 AND expires_at > now()", [idHash]);
    return rows[0]?.user_id ?? null;
  },

  async getMe(userId) {
    const p = pg();
    const { rows } = await p.query<{ id: string; display_name: string | null; email: string | null; role: UserRole; preferences: UserPreferences }>(
      "SELECT id, display_name, email::text AS email, role::text AS role, preferences FROM users WHERE id = $1",
      [userId],
    );
    if (!rows.length) return null;
    const w = await p.query<{ chain_kind: ChainKind; address: string }>(
      "SELECT chain_kind::text AS chain_kind, address FROM user_wallets WHERE user_id = $1 ORDER BY verified_at",
      [userId],
    );
    const u = rows[0];
    return {
      id: u.id,
      displayName: u.display_name,
      email: u.email,
      role: u.role,
      wallets: w.rows.map((r) => ({ chainKind: r.chain_kind, address: r.address })),
      preferences: u.preferences ?? {},
    };
  },

  async patchMe(userId, patch) {
    const sets: string[] = [];
    const params: unknown[] = [userId];
    if (patch.displayName !== undefined) sets.push(`display_name = $${params.push(patch.displayName)}`);
    if (patch.preferences) sets.push(`preferences = preferences || $${params.push(JSON.stringify(patch.preferences))}::jsonb`);
    if (sets.length) await pg().query(`UPDATE users SET ${sets.join(", ")} WHERE id = $1`, params);
    return this.getMe(userId);
  },

  async listWatchlist(userId) {
    const { rows } = await pg().query<{ kind: "token" | "wallet"; chain_id: string; address: string; note: string | null; created_at: Date }>(
      "SELECT kind, chain_id, address, note, created_at FROM watchlist_items WHERE user_id = $1 ORDER BY created_at DESC",
      [userId],
    );
    return rows.map((r) => ({ kind: r.kind, chain: r.chain_id, address: r.address, note: r.note, createdAt: r.created_at.toISOString() }));
  },

  async addWatch(userId, item, max) {
    // Batas dicek dalam satu statement: insert hanya bila jumlah item < max.
    const { rowCount } = await pg().query(
      `INSERT INTO watchlist_items (user_id, kind, chain_id, address, note)
       SELECT $1, $2, $3, $4, $5
        WHERE (SELECT count(*) FROM watchlist_items WHERE user_id = $1) < $6
       ON CONFLICT (user_id, kind, chain_id, address) DO UPDATE SET note = COALESCE(EXCLUDED.note, watchlist_items.note)`,
      [userId, item.kind, item.chain, item.address, item.note ?? null, max],
    );
    if (rowCount) return "ok";
    const exists = await pg().query("SELECT 1 FROM watchlist_items WHERE user_id = $1 AND kind = $2 AND chain_id = $3 AND address = $4", [
      userId,
      item.kind,
      item.chain,
      item.address,
    ]);
    return exists.rowCount ? "ok" : "full";
  },

  async removeWatch(userId, kind, chain, address) {
    await pg().query("DELETE FROM watchlist_items WHERE user_id = $1 AND kind = $2 AND chain_id = $3 AND address = $4", [userId, kind, chain, address]);
  },
};
