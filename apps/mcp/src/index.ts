#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { configFromEnv } from "./client.ts";
import { createServer } from "./server.ts";

/**
 * Server MCP Anthrope Agent (stdio). Env:
 *   ANTHROPE_API_KEY  API key Data API (ak_…), dibuat di halaman Data API
 *   ANTHROPE_API_URL  default http://localhost:4000/api/v1
 * Log hanya ke stderr: stdout dipakai protokol MCP.
 */
const cfg = configFromEnv();
const server = createServer(cfg);
await server.connect(new StdioServerTransport());
console.error(`[anthrope-mcp] siap · API ${cfg.baseUrl} · key ${cfg.apiKey ? "terpasang" : "belum diisi"}`);
