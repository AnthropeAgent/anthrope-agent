import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Satu domain: browser hanya bicara ke web (localhost:3000 di dev).
 * /api/v1/* dan /ws diproksikan ke apps/api. Di produksi, Caddy (infra/Caddyfile) yang melakukan ini
 * sehingga rewrite ini tidak dilewati.
 */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  transpilePackages: ["@ot/types"],
  async rewrites() {
    return [
      { source: "/api/v1/:path*", destination: `${API_INTERNAL_URL}/api/v1/:path*` },
      // WebSocket realtime (upgrade diteruskan oleh server Next; di produksi Caddy)
      { source: "/ws", destination: `${API_INTERNAL_URL}/ws` },
    ];
  },
};

export default nextConfig;
