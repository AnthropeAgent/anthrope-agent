/**
 * Worker Trenches (langkah 9, Solana / pump.fun).
 * Sumber (Mode A, tanpa indexer):
 *  - GeckoTerminal: pool baru Solana (difilter DEX pump.fun), pool pump.fun teraktif 24 jam,
 *    dan pool PumpSwap teraktif (token pump.fun yang sudah migrasi).
 *  - RPC Solana: akun bonding curve (getMultipleAccounts) → progress & flag complete.
 * Hasil: state machine di Redis `trench:state:solana`, tampilan di `trenches:solana`.
 */
import { buildToken, geckoterminal, store, trenches, type GtPool, type TrenchEntry } from "@ot/bridge";
import type { TrenchToken } from "@ot/types";

const CHAIN = "solana" as const;
const SOLANA_RPC = () => process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const PER_COLUMN = 40;
const isPumpDex = (d: string) => d === "pump-fun" || d === "pumpfun";
const isMigrationDex = (d: string) => d === "pumpswap" || d.startsWith("raydium");
/** Mint pump.fun selalu berakhiran "pump" (vanity address). */
const isPumpMint = (a: string) => a.endsWith("pump");

let cycle = 0;

async function readCurves(accounts: string[]): Promise<Map<string, trenches.CurveState>> {
  const out = new Map<string, trenches.CurveState>();
  for (let i = 0; i < accounts.length; i += 100) {
    const chunk = accounts.slice(i, i + 100);
    const res = await fetch(SOLANA_RPC(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [chunk, { encoding: "base64", commitment: "confirmed" }] }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`rpc HTTP ${res.status}`);
    const j = (await res.json()) as { result?: { value: ({ owner: string; data: [string, string] } | null)[] }; error?: unknown };
    j.result?.value.forEach((acc, k) => {
      if (!acc || acc.owner !== trenches.PUMP_PROGRAM) return;
      const c = trenches.decodeCurve(Buffer.from(acc.data[0], "base64"));
      if (c) out.set(chunk[k], c);
    });
  }
  return out;
}

export async function refreshTrenches(log: (m: string) => void): Promise<void> {
  const now = Date.now();
  cycle++;
  // GeckoTerminal dibatasi ±9 panggilan/menit untuk semua loop: 2 panggilan per siklus, PumpSwap tiap siklus ke-2.
  const fresh = (await geckoterminal.listPools(CHAIN, "new")).filter((p) => isPumpDex(p.dex));
  const active = await geckoterminal.dexPools(CHAIN, "pump-fun");
  const migratedPools = cycle % 2 === 1 ? (await geckoterminal.dexPools(CHAIN, "pumpswap")).filter((p) => isPumpMint(p.token.address)) : [];

  const prev = new Map((await store.getTrenchState<TrenchEntry>(CHAIN)).map((e) => [e.address, e]));
  const seen = new Map<string, { pool: GtPool; migrated: boolean }>();
  for (const p of [...fresh, ...active]) if (!seen.has(p.token.address)) seen.set(p.token.address, { pool: p, migrated: false });
  for (const p of migratedPools) seen.set(p.token.address, { pool: p, migrated: true });

  // Curve dibaca untuk semua token yang belum migrasi (baru terlihat + state lama).
  const curveOf = new Map<string, string>();
  for (const [addr, s] of seen) if (!s.migrated && isPumpDex(s.pool.dex)) curveOf.set(addr, s.pool.poolAddress);
  for (const e of prev.values()) if (e.stage !== "migrated" && e.curve && !curveOf.has(e.address)) curveOf.set(e.address, e.curve);
  let curves = new Map<string, trenches.CurveState>();
  try {
    curves = await readCurves([...new Set(curveOf.values())]);
  } catch (e) {
    log(`trenches: rpc curve gagal (${(e as Error).message}), progress memakai nilai lama`);
  }

  const next = new Map<string, TrenchEntry>();
  for (const addr of new Set([...prev.keys(), ...seen.keys()])) {
    const old = prev.get(addr);
    const s = seen.get(addr);
    const curve = curveOf.get(addr) ?? old?.curve ?? null;
    const c = curve ? curves.get(curve) : undefined;
    const token = s ? buildToken(CHAIN, addr, [], s.pool, now) : old?.token;
    if (!token) continue;
    if (s && !s.migrated) token.mainPool = s.pool.poolAddress;
    const entry = trenches.applyObservation(
      old,
      { address: addr, curve, launchpad: "pump.fun", token: { ...token, launchpad: "pump.fun" } },
      { progress: c ? trenches.curveProgress(c) : null, complete: c?.complete ?? false, migrated: !!s?.migrated, active: !!s },
      now,
    );
    // Token yang tidak muncul di daftar siklus ini: snapshot lama, umur tetap bertambah.
    if (!s && old?.token.updatedAt) {
      const since = Math.max(0, Math.round((now - Date.parse(old.token.updatedAt)) / 60_000));
      entry.token = { ...entry.token, ageMinutes: old.token.ageMinutes + since, updatedAt: new Date(now).toISOString() };
    }
    next.set(addr, entry);
  }

  const kept = trenches.pruneEntries([...next.values()], now);
  await store.putTrenchState(CHAIN, kept);

  const col = (st: TrenchEntry["stage"], by: (e: TrenchEntry) => number) =>
    kept
      .filter((e) => e.stage === st)
      .sort((a, b) => by(b) - by(a))
      .slice(0, PER_COLUMN);
  const view = [...col("created", (e) => e.firstSeen), ...col("final_stretch", (e) => e.progress), ...col("migrated", (e) => e.stageChangedAt)];
  const items: TrenchToken[] = view.map((e) => ({
    ...e.token,
    stage: trenches.UI_STAGE[e.stage as keyof typeof trenches.UI_STAGE],
    bondingPct: Math.round(e.progress * 10) / 10,
  }));
  const counts = { created: 0, final_stretch: 0, migrated: 0, dead: 0 } as Record<string, number>;
  for (const e of kept) counts[e.stage]++;
  await store.putTokens(items.map(({ stage: _s, bondingPct: _b, ...t }) => t));
  await store.putTrenches(CHAIN, { items, updatedAt: new Date(now).toISOString(), counts });
  log(`trenches: ${items.length} tampil (baru ${counts.created}, final ${counts.final_stretch}, migrasi ${counts.migrated}, dead ${counts.dead}), curve ${curves.size}`);
}
