/** Kontrak mesin search: hanya mencari KANDIDAT token; data pasar & ranking akhir diambil pemanggil. */
export interface TokenRef {
  chain: string;
  address: string;
}

export interface SearchEngine {
  readonly kind: "postgres" | "meilisearch";
  candidates(q: string, opts: { chain?: string; limit: number }): Promise<TokenRef[]>;
}

/** Dokumen index (Meilisearch). Angka pasar dipakai sebagai custom ranking. */
export interface TokenDoc {
  id: string;
  chain: string;
  address: string;
  symbol: string;
  name: string;
  liquidity: number;
  volume24h: number;
  hidden: boolean;
}

export interface SearchIndexer {
  upsert(docs: TokenDoc[]): Promise<void>;
}

/** Id dokumen Meilisearch hanya boleh [a-zA-Z0-9_-]. */
export const docId = (chain: string, address: string) => `${chain}_${address}`;
