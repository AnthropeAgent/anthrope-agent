import { loadRootEnv } from "@ot/db";
import { z } from "zod";

loadRootEnv();

const Env = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** Origin web yang sah (koma = lebih dari satu). Yang pertama dipakai di pesan login SIWS/SIWE. */
  APP_ORIGIN: z
    .string()
    .default("http://localhost:3000")
    .transform((s) => s.split(",").map((o) => new URL(o.trim()).origin)),
  APP_NAME: z.string().max(40).default("Anthrope Agent"),
  /** Swap (langkah 6). "false" mematikan semua endpoint /swap. */
  SWAP_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  /** Billing API berbayar (langkah 13). Kosong = belum dikonfigurasi, semua key paket Free. */
  STRIPE_SECRET_KEY: z.string().optional(),
  /** CMS admin (langkah 12): wallet yang boleh mengelola artikel, dipisah koma. */
  ADMIN_WALLETS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((w) => w.trim()).filter(Boolean)),
});

export const config = Env.parse(process.env);
