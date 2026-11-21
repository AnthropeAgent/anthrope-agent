import assert from "node:assert/strict";
import { test } from "node:test";
import { splitClickhouse } from "@ot/db";
import type { ApiError, HealthResponse } from "@ot/types";
import { buildApp } from "./app";

test("GET /api/v1/health returns status and per-service state", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/api/v1/health" });
  assert.equal(res.statusCode, 200);
  const body = res.json<HealthResponse>();
  assert.ok(body.status === "ok" || body.status === "degraded");
  for (const k of ["postgres", "clickhouse", "redis"] as const) {
    assert.ok(["up", "down", "not_configured"].includes(body.services[k].state), k);
  }
  await app.close();
});

test("unknown route returns 404 in ApiError shape", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/api/v1/nope" });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json<ApiError>().error.code, "NOT_FOUND");
  await app.close();
});

test("splitClickhouse ignores comments and splits statements", () => {
  const sql = "-- a; b;\nCREATE TABLE x (a UInt8)\nENGINE = Memory;\n\n-- SELECT 1;\nCREATE TABLE y (b UInt8) ENGINE = Memory;\n";
  assert.deepEqual(splitClickhouse(sql), ["CREATE TABLE x (a UInt8)\nENGINE = Memory", "CREATE TABLE y (b UInt8) ENGINE = Memory"]);
});
