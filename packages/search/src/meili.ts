/**
 * Mesin search utama: Meilisearch (ARCHITECTURE §4.11) lewat REST API-nya, tanpa SDK.
 * Index `tokens`: searchable symbol/name/address, filter chain/hidden, ranking + likuiditas & volume.
 */
import type { SearchEngine, SearchIndexer, TokenDoc, TokenRef } from "./engine";
import { normalizeQuery } from "./rank";

export const MEILI_INDEX = "tokens";

export const MEILI_SETTINGS = {
  searchableAttributes: ["symbol", "name", "address"],
  filterableAttributes: ["chain", "hidden"],
  sortableAttributes: ["liquidity", "volume24h"],
  rankingRules: ["words", "typo", "exactness", "attribute", "proximity", "liquidity:desc", "volume24h:desc"],
  typoTolerance: { disableOnAttributes: ["address"] },
};

type Fetch = typeof fetch;

export class MeiliClient {
  constructor(
    private readonly url: string,
    private readonly key: string | undefined,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.url.replace(/\/$/, "")}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(this.key ? { authorization: `Bearer ${this.key}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`meilisearch ${method} ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

/** Nilai filter Meilisearch: hanya huruf/angka/strip supaya input tidak bisa mengubah ekspresi filter. */
const filterValue = (s: string) => s.replace(/[^a-z0-9-]/gi, "");

export function meiliEngine(client: MeiliClient): SearchEngine {
  return {
    kind: "meilisearch",
    async candidates(q, { chain, limit }) {
      const s = normalizeQuery(q);
      if (!s) return [];
      const filter = ["hidden = false", ...(chain ? [`chain = "${filterValue(chain)}"`] : [])];
      const r = await client.req<{ hits: Pick<TokenDoc, "chain" | "address">[] }>("POST", `/indexes/${MEILI_INDEX}/search`, {
        q: s,
        limit,
        filter,
        attributesToRetrieve: ["chain", "address"],
      });
      return r.hits.map((h): TokenRef => ({ chain: h.chain, address: h.address }));
    },
  };
}

/** Indexer untuk worker. Setting index dikirim sekali per proses (idempoten di Meilisearch). */
export function meiliIndexer(client: MeiliClient): SearchIndexer {
  let configured = false;
  return {
    async upsert(docs) {
      if (!configured) {
        await client.req("PATCH", `/indexes/${MEILI_INDEX}/settings`, MEILI_SETTINGS);
        configured = true;
      }
      if (docs.length) await client.req("PUT", `/indexes/${MEILI_INDEX}/documents?primaryKey=id`, docs);
    },
  };
}
