import { clickhouse, postgres, redis } from "@ot/db";
import type { HealthResponse, ServiceState } from "@ot/types";

type Check = HealthResponse["services"]["postgres"];

const TIMEOUT_MS = 2000;

async function timed(fn: () => Promise<unknown>): Promise<Check> {
  const t0 = performance.now();
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS))]);
    return { state: "up", latencyMs: Math.round(performance.now() - t0) };
  } catch (e) {
    return { state: "down", error: (e as Error).message || "error" };
  }
}

const notConfigured: Check = { state: "not_configured" as ServiceState };

export async function checkHealth(version: string, startedAt: number): Promise<HealthResponse> {
  const pg = postgres();
  const ch = clickhouse();
  const rd = redis();
  const [p, c, r] = await Promise.all([
    pg ? timed(() => pg.query("SELECT 1")) : notConfigured,
    ch ? timed(async () => { const res = await ch.ping(); if (!res.success) throw res.error; }) : notConfigured,
    rd ? timed(async () => { if (rd.status === "wait") await rd.connect(); await rd.ping(); }) : notConfigured,
  ]);
  const services = { postgres: p, clickhouse: c, redis: r };
  return {
    status: Object.values(services).every((s) => s.state === "up") ? "ok" : "degraded",
    version,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    services,
  };
}
