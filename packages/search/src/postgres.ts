/**
 * Mesin search fallback: Postgres pg_trgm pada tabel `tokens` (diisi worker).
 * Dipakai bila Meilisearch tidak dikonfigurasi (misal dev tanpa Docker).
 */
import type { Pool } from "pg";
import type { SearchEngine, TokenRef } from "./engine";
import { normalizeQuery } from "./rank";

/** Escape wildcard LIKE supaya input user tidak menjadi pola. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function postgresEngine(pool: Pick<Pool, "query">): SearchEngine {
  return {
    kind: "postgres",
    async candidates(q, { chain, limit }) {
      const s = normalizeQuery(q);
      if (!s) return [];
      const params: unknown[] = [s, `${likeEscape(s)}%`, `%${likeEscape(s)}%`, limit];
      const chainSql = chain ? `AND chain_id = $${params.push(chain)}` : "";
      const { rows } = await pool.query<{ chain_id: string; address: string }>(
        `SELECT chain_id, address
           FROM tokens
          WHERE NOT hidden ${chainSql}
            AND (lower(symbol) LIKE $2 OR lower(name) LIKE $3 OR symbol % $1 OR name % $1)
          ORDER BY (lower(symbol) = $1) DESC,
                   (lower(symbol) LIKE $2) DESC,
                   greatest(similarity(lower(symbol), $1), similarity(lower(name), $1)) DESC
          LIMIT $4`,
        params,
      );
      return rows.map((r): TokenRef => ({ chain: r.chain_id, address: r.address }));
    },
  };
}
