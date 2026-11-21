import assert from "node:assert/strict";
import { test } from "node:test";
import { addressKind, likeEscape, matchTier, MeiliClient, meiliEngine, meiliIndexer, normalizeQuery, postgresEngine, rankTokens } from "../src/index";

const tok = (symbol: string, name: string, liquidity: number, volume24h = 0, address = `${symbol}addr`) => ({ symbol, name, liquidity, volume24h, address });

test("deteksi alamat dan normalisasi query", () => {
  assert.equal(addressKind("0x4200000000000000000000000000000000000006"), "evm");
  assert.equal(addressKind(" So11111111111111111111111111111111111111112 "), "solana");
  assert.equal(addressKind("bonk"), null);
  assert.equal(addressKind("0x123"), null);
  assert.equal(normalizeQuery("  $BONK  "), "bonk");
  assert.equal(normalizeQuery("dog  wif   hat"), "dog wif hat");
});

test("ranking: simbol persis > awalan > nama, lalu likuiditas (tiruan turun)", () => {
  const real = tok("USDC", "USD Coin", 5_000_000);
  const fake = tok("USDC", "USD Coin", 900);
  const prefix = tok("USDCX", "Something", 9_000_000);
  const byName = tok("XYZ", "usdc wrapped", 50_000_000);
  const ranked = rankTokens("usdc", [byName, fake, prefix, real]);
  assert.deepEqual(ranked, [real, fake, prefix, byName]);
  assert.equal(matchTier("usdcaddr", real), 0); // alamat persis paling atas
  assert.equal(matchTier("uscd", real), 5); // typo: hanya dari mesin fuzzy
});

test("Postgres: wildcard LIKE di-escape, filter chain jadi parameter", async () => {
  assert.equal(likeEscape("50%_off\\"), "50\\%\\_off\\\\");
  const calls: { sql: string; params: unknown[] }[] = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows: [{ chain_id: "base", address: "0xabc" }] };
    },
  };
  const engine = postgresEngine(pool as never);
  const r = await engine.candidates("$Pe%pe", { chain: "base", limit: 20 });
  assert.deepEqual(r, [{ chain: "base", address: "0xabc" }]);
  assert.deepEqual(calls[0].params, ["pe%pe", "pe\\%pe%", "%pe\\%pe%", 20, "base"]);
  assert.match(calls[0].sql, /chain_id = \$5/);
  assert.doesNotMatch(calls[0].sql, /pe%pe/); // nilai user tidak pernah masuk SQL
  assert.deepEqual(await engine.candidates("   ", { limit: 5 }), []);
});

test("Meilisearch: request search & indexer, filter chain disaring", async () => {
  const reqs: { url: string; method: string; body: unknown; auth?: string }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    reqs.push({ url, method: init.method!, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: (init.headers as Record<string, string>).authorization });
    return new Response(JSON.stringify({ hits: [{ chain: "solana", address: "A" }], taskUid: 1 }), { status: 200 });
  }) as typeof fetch;
  const client = new MeiliClient("http://meili:7700/", "k", fakeFetch);

  const hits = await meiliEngine(client).candidates("BONK", { chain: 'solana" OR hidden = true', limit: 10 });
  assert.deepEqual(hits, [{ chain: "solana", address: "A" }]);
  assert.equal(reqs[0].url, "http://meili:7700/indexes/tokens/search");
  assert.equal(reqs[0].auth, "Bearer k");
  assert.deepEqual((reqs[0].body as { filter: string[] }).filter, ["hidden = false", 'chain = "solanaORhiddentrue"']);

  const idx = meiliIndexer(client);
  await idx.upsert([{ id: "solana_A", chain: "solana", address: "A", symbol: "BONK", name: "Bonk", liquidity: 1, volume24h: 1, hidden: false }]);
  await idx.upsert([]);
  assert.deepEqual(
    reqs.slice(1).map((r) => `${r.method} ${new URL(r.url).pathname}`),
    ["PATCH /indexes/tokens/settings", "PUT /indexes/tokens/documents"], // settings hanya sekali
  );
});
