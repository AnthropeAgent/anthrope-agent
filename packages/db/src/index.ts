/**
 * Klien database bersama untuk api dan workers.
 * Setiap klien dibuat sekali (lazy) dan hanya jika variabel env-nya diisi.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { Redis } from "ioredis";
import pg from "pg";
import { dbConfig } from "./env";

export { dbConfig, loadRootEnv } from "./env";
export { splitClickhouse } from "./split";

let _pg: pg.Pool | null | undefined;
let _ch: ClickHouseClient | null | undefined;
let _redis: Redis | null | undefined;

export function postgres(): pg.Pool | null {
  if (_pg !== undefined) return _pg;
  const { postgresUrl } = dbConfig();
  _pg = postgresUrl ? new pg.Pool({ connectionString: postgresUrl, max: 10, connectionTimeoutMillis: 3000 }) : null;
  return _pg;
}

export function clickhouse(): ClickHouseClient | null {
  if (_ch !== undefined) return _ch;
  const c = dbConfig();
  _ch = c.clickhouseUrl
    ? createClient({ url: c.clickhouseUrl, username: c.clickhouseUser, password: c.clickhousePassword, database: c.clickhouseDb, request_timeout: 5000 })
    : null;
  return _ch;
}

export function redis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const { redisUrl } = dbConfig();
  _redis = redisUrl ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000, enableOfflineQueue: false }) : null;
  _redis?.on("error", () => {
    /* status dilaporkan lewat health check, jangan crash proses */
  });
  return _redis;
}

/**
 * Koneksi Redis BARU khusus pub/sub (koneksi dalam mode subscribe tidak bisa menjalankan perintah lain).
 * Bukan singleton: pemanggil wajib menutupnya. Reconnect & resubscribe otomatis (ioredis).
 */
export function redisSubscriber(): Redis | null {
  const { redisUrl } = dbConfig();
  if (!redisUrl) return null;
  const r = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: null, connectTimeout: 3000 });
  r.on("error", () => {
    /* reconnect ditangani ioredis */
  });
  return r;
}

/** Tutup semua koneksi dan reset singleton, supaya pemanggilan berikutnya membuat klien baru. */
export async function closeAll() {
  const [p, c, r] = [_pg, _ch, _redis];
  _pg = _ch = _redis = undefined;
  await Promise.allSettled([p?.end(), c?.close(), r && r.status !== "wait" ? r.quit() : r?.disconnect()]);
}
