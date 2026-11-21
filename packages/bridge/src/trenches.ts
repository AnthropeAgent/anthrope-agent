/**
 * Trenches (langkah 9, Solana / pump.fun dulu). Bagian murni: decode akun bonding curve dan
 * state machine tahap token (ARCHITECTURE §4.7):
 *
 *   created ──(progress ≥ 60%)──▶ final_stretch ──(curve complete / pool PumpSwap)──▶ migrated
 *      └──────────(tidak aktif 24 jam dan progress < 5%)──────────▶ dead (disembunyikan)
 *
 * Tahap tidak pernah mundur dari migrated. Progress = porsi token curve yang sudah terjual.
 */
import type { Token } from "@ot/types";

/** Program pump.fun; pemilik akun bonding curve. */
export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
/** Token yang dijual lewat curve saat awal (793.1 juta token, 6 desimal). */
export const PUMP_CURVE_TOKENS = 793_100_000_000_000n;
export const FINAL_STRETCH_PCT = 60;
export const DEAD_AFTER_MS = 24 * 3_600_000;
export const DEAD_MAX_PCT = 5;

export interface CurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

/** Layout: 8 byte discriminator, 5 × u64 LE, lalu 1 byte `complete`. */
export function decodeCurve(data: Uint8Array): CurveState | null {
  if (data.length < 49) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u = (o: number) => v.getBigUint64(o, true);
  return {
    virtualTokenReserves: u(8),
    virtualSolReserves: u(16),
    realTokenReserves: u(24),
    realSolReserves: u(32),
    tokenTotalSupply: u(40),
    complete: data[48] === 1,
  };
}

export function curveProgress(c: CurveState): number {
  if (c.complete) return 100;
  const left = c.realTokenReserves > PUMP_CURVE_TOKENS ? PUMP_CURVE_TOKENS : c.realTokenReserves;
  const sold = Number(PUMP_CURVE_TOKENS - left);
  return Math.max(0, Math.min(100, (sold / Number(PUMP_CURVE_TOKENS)) * 100));
}

export type TrenchFsmStage = "created" | "final_stretch" | "migrated" | "dead";

export interface TrenchEntry {
  address: string;
  /** Akun bonding curve (pool pump.fun) bila diketahui. */
  curve: string | null;
  launchpad: string;
  stage: TrenchFsmStage;
  progress: number;
  firstSeen: number;
  stageChangedAt: number;
  /** Terakhir terlihat aktif (muncul di daftar pool aktif / progress berubah). */
  lastActive: number;
  token: Token;
}

export interface Observation {
  progress: number | null;
  complete: boolean;
  /** Token terlihat punya pool di DEX tujuan migrasi (PumpSwap/Raydium). */
  migrated: boolean;
  active: boolean;
}

export function nextStage(prev: Pick<TrenchEntry, "stage" | "lastActive"> | undefined, o: Observation, now: number): TrenchFsmStage {
  if (prev?.stage === "migrated" || o.migrated || o.complete) return "migrated";
  const progress = o.progress ?? 0;
  const lastActive = o.active ? now : (prev?.lastActive ?? now);
  if (now - lastActive > DEAD_AFTER_MS && progress < DEAD_MAX_PCT) return "dead";
  if (progress >= FINAL_STRETCH_PCT) return "final_stretch";
  return "created";
}

/** Terapkan observasi ke entry (atau buat baru). */
export function applyObservation(
  prev: TrenchEntry | undefined,
  base: Omit<TrenchEntry, "stage" | "progress" | "firstSeen" | "stageChangedAt" | "lastActive">,
  o: Observation,
  now: number,
): TrenchEntry {
  const stage = nextStage(prev, o, now);
  const progress = stage === "migrated" ? 100 : (o.progress ?? prev?.progress ?? 0);
  const moved = prev ? progress !== prev.progress : true;
  return {
    ...base,
    curve: base.curve ?? prev?.curve ?? null,
    stage,
    progress,
    firstSeen: prev?.firstSeen ?? now,
    stageChangedAt: prev && prev.stage === stage ? prev.stageChangedAt : now,
    lastActive: o.active || moved ? now : (prev?.lastActive ?? now),
  };
}

/** Pangkas state: buang dead lama dan entry yang sudah lama tidak terlihat; batasi ukuran. */
export function pruneEntries(entries: TrenchEntry[], now: number, max = 300): TrenchEntry[] {
  return entries
    .filter((e) => (e.stage === "dead" ? now - e.stageChangedAt < 3_600_000 : now - e.lastActive < (e.stage === "migrated" ? 24 : 6) * 3_600_000))
    .sort((a, b) => b.lastActive - a.lastActive)
    .slice(0, max);
}

export const UI_STAGE = { created: "new", final_stretch: "final", migrated: "migrated" } as const;
