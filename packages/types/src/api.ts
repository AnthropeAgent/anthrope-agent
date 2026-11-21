/** Bentuk respons umum /api/v1 (lihat docs/api/openapi.yaml). */
export interface ApiError {
  error: { code: string; message: string };
}

export interface Page<T> {
  items: T[];
  nextCursor?: string | null;
  updatedAt?: string;
}

export type ServiceState = "up" | "down" | "not_configured";

export interface HealthResponse {
  status: "ok" | "degraded";
  version: string;
  uptimeSec: number;
  services: Record<"postgres" | "clickhouse" | "redis", { state: ServiceState; latencyMs?: number; error?: string }>;
}
