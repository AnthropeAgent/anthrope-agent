import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildUrl } from "./client.ts";
import { createServer } from "./server.ts";

const cfg = { baseUrl: "http://api.test/api/v1", apiKey: "ak_test" };

async function connect(fetchImpl: typeof fetch) {
  const server = createServer(cfg, fetchImpl);
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

test("buildUrl drops empty params", () => {
  assert.equal(buildUrl(cfg, "/search", { q: "bonk", chain: undefined, limit: 5 }).toString(), "http://api.test/api/v1/search?q=bonk&limit=5");
});

test("lists read-only tools and prompts", async () => {
  const { client, close } = await connect(fetch);
  const { tools } = await client.listTools();
  assert.ok(tools.length >= 12);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
  const { prompts } = await client.listPrompts();
  assert.deepEqual(prompts.map((p) => p.name).sort(), ["market_brief", "token_due_diligence"]);
  await close();
});

test("get_token calls API with key and returns JSON", async () => {
  let seen: { url: string; key: string | null } | null = null;
  const fake = (async (url: URL, init?: RequestInit) => {
    seen = { url: String(url), key: new Headers(init?.headers).get("x-api-key") };
    return new Response(JSON.stringify({ symbol: "BONK", pending: true }), { status: 200 });
  }) as unknown as typeof fetch;
  const { client, close } = await connect(fake);
  const r = (await client.callTool({ name: "get_token", arguments: { chain: "solana", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" } })) as { content: { text: string }[] };
  assert.equal(seen!.url, "http://api.test/api/v1/tokens/solana/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
  assert.equal(seen!.key, "ak_test");
  assert.match(r.content[0].text, /BONK/);
  assert.match(r.content[1].text, /pending/);
  await close();
});

test("API errors become tool errors", async () => {
  const fake = (async () => new Response(JSON.stringify({ error: { message: "invalid key" } }), { status: 401 })) as unknown as typeof fetch;
  const { client, close } = await connect(fake);
  const r = (await client.callTool({ name: "perps_overview", arguments: {} })) as { isError?: boolean; content: { text: string }[] };
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /401: invalid key/);
  await close();
});
