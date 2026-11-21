/**
 * Holders & security scan (langkah 7). Hanya token yang sedang dibuka user (view `holders`), maks
 * 3 token per siklus, karena GoPlus gratis dibatasi ±30 panggilan/menit. Hasil ke Postgres.
 */
import { isBridgeChain, isValidAddress, scanStore, security, store, type BridgeChain } from "@ot/bridge";

const MAX_PER_CYCLE = 3;
/** Gagal scan: coba lagi paling cepat setelah ini (supaya token bermasalah tidak menyumbat antrean). */
const RETRY_MS = 2 * 60_000;
const failedAt = new Map<string, number>();

const SOLANA_RPC = () => process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

export async function runScans(log: (m: string) => void): Promise<void> {
  const now = Date.now();
  const views = (await store.activeViews()).filter((v) => v.kind === "holders" && isBridgeChain(v.chain) && isValidAddress(v.chain, v.address));
  if (!views.length) return;
  const ages = await scanStore.scanAges(views);
  const due = views
    .map((v) => ({ ...v, at: ages.get(`${v.chain}:${v.address}`) ?? 0 }))
    .filter((v) => now - v.at > scanStore.HOLDERS_MAX_AGE_MS && now - (failedAt.get(`${v.chain}:${v.address}`) ?? 0) > RETRY_MS)
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_PER_CYCLE);
  for (const v of due) {
    const chain = v.chain as BridgeChain;
    const key = `${chain}:${v.address}`;
    try {
      const token = await store.getToken(chain, v.address);
      const r = await security.scanToken(chain, v.address, token, { solanaRpc: SOLANA_RPC() });
      if (!r) {
        failedAt.set(key, Date.now());
        log(`scan ${key}: belum ada data di provider`);
        continue;
      }
      await scanStore.putScan(chain, v.address, r);
      failedAt.delete(key);
      log(`scan ${key}: skor ${r.report.score ?? "?"}, ${r.holders.items.length} holder (${r.report.source})`);
    } catch (e) {
      failedAt.set(key, Date.now());
      log(`scan ${key} gagal: ${(e as Error).message}`);
    }
  }
}
