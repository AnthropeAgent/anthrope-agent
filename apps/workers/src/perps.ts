/**
 * Worker Perps (langkah 10, Hyperliquid).
 *  - Pasar tiap siklus (60 dtk).
 *  - Leaderboard (populasi akun) tiap 30 menit; file ±38 MB jadi tidak lebih sering.
 *  - Posisi wallet sampel bergiliran (POSITIONS_PER_CYCLE per siklus), sampel tertua dulu.
 */
import { perps, store, type HlPositions, type HlWallet } from "@ot/bridge";
import type { PerpsDoc } from "@ot/types";

const LEADERBOARD_EVERY_MS = 30 * 60_000;
const POSITIONS_PER_CYCLE = 100;
const POSITION_MAX_AGE_MS = 6 * 3_600_000;

let population: HlWallet[] = [];
let sample: HlWallet[] = [];
let leaderboardAt = 0;
let pos: Map<string, HlPositions> | null = null;

export async function refreshPerps(log: (m: string) => void): Promise<void> {
  const now = Date.now();
  if (!pos) pos = new Map(Object.entries((await store.getJson<Record<string, HlPositions>>("perps:positions")) ?? {}));

  if (now - leaderboardAt > LEADERBOARD_EVERY_MS || !population.length) {
    try {
      population = await perps.leaderboard();
      sample = perps.pickSample(population);
      leaderboardAt = now;
      log(`perps: leaderboard ${population.length} akun, sampel posisi ${sample.length}`);
    } catch (e) {
      log(`perps: leaderboard gagal (${(e as Error).message})`);
      if (!population.length) leaderboardAt = now - LEADERBOARD_EVERY_MS + 5 * 60_000; // coba lagi 5 menit lagi
    }
  }

  const markets = await perps.markets();

  // Posisi: sampel yang belum pernah dibaca dulu, lalu yang paling lama.
  const due = sample
    .filter((w) => !(now - (pos!.get(w.address)?.at ?? 0) < 10 * 60_000))
    .sort((a, b) => (pos!.get(a.address)?.at ?? 0) - (pos!.get(b.address)?.at ?? 0))
    .slice(0, POSITIONS_PER_CYCLE);
  let failed = 0;
  for (const w of due) {
    try {
      pos.set(w.address, await perps.positions(w.address));
    } catch {
      failed++;
    }
  }
  const sampled = new Set(sample.map((w) => w.address));
  for (const [a, p] of pos) if (!sampled.has(a) || now - p.at > POSITION_MAX_AGE_MS) pos.delete(a);
  await store.putJson("perps:positions", Object.fromEntries(pos));

  const s = perps.summarize(population, pos);
  const doc: PerpsDoc = {
    source: "hyperliquid",
    markets: markets.slice(0, 60),
    ...s,
    wallets: population.length,
    sampled: pos.size,
    updatedAt: new Date(now).toISOString(),
    leaderboardAt: leaderboardAt ? new Date(leaderboardAt).toISOString() : null,
  };
  await store.putPerps(doc);
  log(`perps: ${markets.length} pasar, posisi ${pos.size}/${sample.length} wallet sampel${failed ? `, ${failed} gagal` : ""}`);
}
