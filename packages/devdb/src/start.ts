/**
 * Database lokal TANPA Docker, khusus dev di mesin yang tidak punya Docker/WSL.
 *
 *   npm run db:local      # Postgres :5432 (PGlite) + Redis :6379 (in-memory)
 *
 * - Postgres: PGlite (Postgres 18 versi WASM) diekspos lewat wire protocol, data disimpan di .devdb/pg.
 *   Kueri dari banyak koneksi diantre jadi satu; jangan pakai untuk uji konkurensi/transaksi paralel.
 * - Redis: server RESP kecil di memori (lihat ./redis.ts). Hanya perintah yang dipakai app.
 * - ClickHouse: tidak ada build Windows; tetap butuh Docker/WSL. Kosongkan CLICKHOUSE_URL agar
 *   migrator melewatinya dan health check melapor `not_configured`.
 *
 * Untuk produksi/staging tetap pakai infra/docker-compose.yml.
 */
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { startRedis } from "./redis";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const dataDir = join(repoRoot, ".devdb", "pg");
const HOST = "127.0.0.1";
const PG_PORT = Number(process.env.DEVDB_PG_PORT ?? 5432);
const REDIS_PORT = Number(process.env.DEVDB_REDIS_PORT ?? 6379);

mkdirSync(dataDir, { recursive: true });

const db = await PGlite.create({ dataDir, extensions: { citext, pg_trgm } });
const pgServer = new PGLiteSocketServer({ db, host: HOST, port: PG_PORT, maxConnections: 20 });
await pgServer.start();
console.log(`postgres (PGlite) siap di ${HOST}:${PG_PORT}  data: .devdb/pg`);

const redisServer = await startRedis(HOST, REDIS_PORT);
console.log(`redis (in-memory) siap di ${HOST}:${REDIS_PORT}`);
console.log("clickhouse: tidak tersedia tanpa Docker/WSL (kosongkan CLICKHOUSE_URL di .env)");
console.log("Ctrl+C untuk berhenti.");

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled([pgServer.stop(), new Promise((r) => redisServer.close(r))]);
  await db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
