/**
 * Migrator sederhana: menjalankan file SQL berurutan dari migrations/{postgres,clickhouse}
 * dan mencatat yang sudah jalan di tabel schema_migrations masing-masing DB.
 *
 *   npm run db:migrate              # keduanya
 *   npm run db:migrate -- postgres  # salah satu
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clickhouse, closeAll, postgres } from "./index";
import { splitClickhouse } from "./split";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");
const files = (db: string) =>
  readdirSync(join(root, db))
    .filter((f) => f.endsWith(".sql"))
    .sort();

async function migratePostgres() {
  const pool = postgres();
  if (!pool) return console.log("postgres: DATABASE_URL kosong, dilewati");
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  for (const f of files("postgres")) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(root, "postgres", f), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
      await client.query("COMMIT");
      console.log(`postgres: ${f} ✓`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`postgres: ${f} gagal: ${(e as Error).message}`);
    } finally {
      client.release();
    }
  }
}

async function migrateClickhouse() {
  const ch = clickhouse();
  if (!ch) return console.log("clickhouse: CLICKHOUSE_URL kosong, dilewati");
  await ch.command({ query: "CREATE TABLE IF NOT EXISTS schema_migrations (name String, applied_at DateTime DEFAULT now()) ENGINE = MergeTree ORDER BY name" });
  const rs = await ch.query({ query: "SELECT name FROM schema_migrations", format: "JSONEachRow" });
  const done = new Set((await rs.json<{ name: string }>()).map((r) => r.name));
  for (const f of files("clickhouse")) {
    if (done.has(f)) continue;
    // Catatan: DDL ClickHouse tidak transaksional. Jika gagal di tengah, perbaiki manual lalu jalankan ulang.
    for (const stmt of splitClickhouse(readFileSync(join(root, "clickhouse", f), "utf8"))) {
      await ch.command({ query: stmt });
    }
    await ch.insert({ table: "schema_migrations", values: [{ name: f }], format: "JSONEachRow" });
    console.log(`clickhouse: ${f} ✓`);
  }
}

const target = process.argv[2];
try {
  if (!target || target === "postgres") await migratePostgres();
  if (!target || target === "clickhouse") await migrateClickhouse();
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await closeAll();
}
