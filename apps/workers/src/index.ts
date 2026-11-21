/**
 * Proses workers: provider bridge (langkah 1: token & Discover, langkah 2: chart & trades),
 * tracker status swap (langkah 6), holders & security scan (langkah 7),
 * top traders & profil wallet (langkah 8), Trenches pump.fun (langkah 9), perps Hyperliquid (langkah 10), alerts (langkah 11).
 *   npm run dev -w @ot/workers
 */
import { closeAll, redis } from "@ot/db";
import { StoreUnavailableError } from "@ot/bridge";
import { Bridge } from "./bridge";
import { runScans } from "./scans";
import { trackSwaps } from "./swaps";
import { runAlerts } from "./alerts";
import { refreshPerps } from "./perps";
import { refreshTrenches } from "./trenches";
import { aggregateTraders, refreshWallets } from "./wallets";

const DISCOVERY_MS = 150_000;
const METRICS_MS = 30_000;
const CHARTS_MS = 10_000;
const SWAPS_MS = 10_000;
const SCANS_MS = 5_000;
const TRADERS_MS = 60_000;
const WALLETS_MS = 5_000;
const TRENCHES_MS = 40_000;
const PERPS_MS = 60_000;
const ALERTS_MS = 15_000;

const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

if (!redis()) {
  console.error("REDIS_URL kosong: bridge butuh Redis (npm run db:up atau npm run db:local).");
  process.exit(1);
}

const bridge = new Bridge(log);
let stopping = false;

/** Jalankan `fn` berulang dengan jeda `ms` SETELAH selesai (tidak tumpang tindih). */
function loop(name: string, ms: number, fn: () => Promise<void>) {
  const tick = async () => {
    if (stopping) return;
    try {
      await fn();
    } catch (e) {
      if (e instanceof StoreUnavailableError) log(`${name}: redis belum siap, coba lagi nanti`);
      else log(`${name} gagal: ${(e as Error).stack ?? e}`);
    }
    if (!stopping) setTimeout(tick, ms);
  };
  return tick();
}

// Discovery dulu supaya metrics punya daftar token, lalu keduanya berjalan sendiri-sendiri.
log("bridge mulai: discovery & charts GeckoTerminal, metrics DexScreener");
await loop("discovery", DISCOVERY_MS, () => bridge.discovery());
void loop("metrics", METRICS_MS, () => bridge.metrics());
void loop("charts", CHARTS_MS, () => bridge.charts());
void loop("swaps", SWAPS_MS, () => trackSwaps(log));
void loop("scans", SCANS_MS, () => runScans(log));
void loop("traders", TRADERS_MS, () => aggregateTraders(log));
void loop("wallets", WALLETS_MS, () => refreshWallets(log));
void loop("trenches", TRENCHES_MS, () => refreshTrenches(log));
void loop("perps", PERPS_MS, () => refreshPerps(log));
void loop("alerts", ALERTS_MS, () => runAlerts(log));

const shutdown = async () => {
  stopping = true;
  await closeAll();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
