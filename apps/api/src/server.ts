import { buildApp } from "./app";
import { config } from "./config";

const app = buildApp({ logger: { level: config.LOG_LEVEL } });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close(); // onClose menutup koneksi database
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.API_HOST, port: config.API_PORT });
