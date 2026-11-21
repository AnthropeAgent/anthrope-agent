import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Muat .env dari root repo (sekali), tanpa menimpa variabel yang sudah ada. */
let loaded = false;
export function loadRootEnv() {
  if (loaded) return;
  loaded = true;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const p = resolve(dir, ".env");
    if (existsSync(p)) {
      process.loadEnvFile(p);
      return;
    }
    dir = resolve(dir, "..");
  }
}

export interface DbConfig {
  postgresUrl?: string;
  clickhouseUrl?: string;
  clickhouseUser?: string;
  clickhousePassword?: string;
  clickhouseDb?: string;
  redisUrl?: string;
}

export function dbConfig(): DbConfig {
  loadRootEnv();
  return {
    postgresUrl: process.env.DATABASE_URL || undefined,
    clickhouseUrl: process.env.CLICKHOUSE_URL || undefined,
    clickhouseUser: process.env.CLICKHOUSE_USER || "default",
    clickhousePassword: process.env.CLICKHOUSE_PASSWORD || "",
    clickhouseDb: process.env.CLICKHOUSE_DB || "default",
    redisUrl: process.env.REDIS_URL || undefined,
  };
}
