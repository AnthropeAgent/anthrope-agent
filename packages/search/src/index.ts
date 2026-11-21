import { loadRootEnv, postgres } from "@ot/db";
import type { SearchEngine, SearchIndexer } from "./engine";
import { MeiliClient, meiliEngine, meiliIndexer } from "./meili";
import { postgresEngine } from "./postgres";

export * from "./engine";
export * from "./rank";
export { MeiliClient, meiliEngine, meiliIndexer, MEILI_INDEX, MEILI_SETTINGS } from "./meili";
export { likeEscape, postgresEngine } from "./postgres";

function meiliClient(): MeiliClient | null {
  loadRootEnv();
  const url = process.env.MEILI_URL;
  return url ? new MeiliClient(url, process.env.MEILI_MASTER_KEY || undefined) : null;
}

/** Mesin search dari env: Meilisearch bila MEILI_URL diisi, kalau tidak Postgres, kalau tidak null. */
export function searchEngine(): SearchEngine | null {
  const m = meiliClient();
  if (m) return meiliEngine(m);
  const pool = postgres();
  return pool ? postgresEngine(pool) : null;
}

/** Indexer untuk worker; null bila Meilisearch tidak dipakai (Postgres diisi lewat upsert metadata). */
export function searchIndexer(): SearchIndexer | null {
  const m = meiliClient();
  return m ? meiliIndexer(m) : null;
}
