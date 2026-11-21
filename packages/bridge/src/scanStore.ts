/**
 * Penyimpanan hasil scan holders & security (langkah 7), Postgres.
 * Worker menulis (putScan); api membaca (getReport, getHolders).
 * Antrean: api menandai view `holders`/`security` lewat store Redis (touchView); worker memindai token
 * yang sedang dilihat dan datanya sudah tua.
 */
import { postgres } from "@ot/db";
import type { HoldersSnapshot, SecurityReport } from "@ot/types";
import type { ScanResult } from "./security";

/** Holders di-refresh tiap 5 menit selama dilihat; security tiap 6 jam (ARCHITECTURE §4.4, §4.5). */
export const HOLDERS_MAX_AGE_MS = 5 * 60_000;
export const SECURITY_MAX_AGE_MS = 6 * 3_600_000;

export class ScanStoreUnavailableError extends Error {
  constructor() {
    super("postgres tidak dikonfigurasi");
  }
}

function db() {
  const p = postgres();
  if (!p) throw new ScanStoreUnavailableError();
  return p;
}

export async function putScan(chain: string, address: string, r: ScanResult): Promise<void> {
  const s = r.report.summary;
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO token_security (chain_id, address, score, mint_revoked, freeze_revoked, lp_burned_pct, honeypot, buy_tax_pct, sell_tax_pct,
                                   top10_pct, dev_holding_pct, flags, report, source, scanned_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
       ON CONFLICT (chain_id, address) DO UPDATE SET score=$3, mint_revoked=$4, freeze_revoked=$5, lp_burned_pct=$6, honeypot=$7,
         buy_tax_pct=$8, sell_tax_pct=$9, top10_pct=$10, dev_holding_pct=$11, flags=$12, report=$13, source=$14, scanned_at=now()`,
      [chain, address, r.report.score ?? 0, s.mintRevoked, s.freezeRevoked, s.lpBurnedPct, s.honeypot, s.buyTax, s.sellTax, r.report.top10Pct, null, r.report.flags, r.report, r.report.source],
    );
    await client.query(
      `INSERT INTO holder_snapshots (chain_id, address, holder_count, top10_pct, items, source, taken_at)
       VALUES ($1,$2,$3,$4,$5,$6, now())
       ON CONFLICT (chain_id, address) DO UPDATE SET holder_count=$3, top10_pct=$4, items=$5, source=$6, taken_at=now()`,
      [chain, address, r.holders.holderCount, r.holders.top10Pct, JSON.stringify(r.holders.items), r.holders.source],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function getReport(chain: string, address: string): Promise<SecurityReport | null> {
  const { rows } = await db().query<{ report: SecurityReport | null; scanned_at: Date }>(
    "SELECT report, scanned_at FROM token_security WHERE chain_id=$1 AND address=$2",
    [chain, address],
  );
  const r = rows[0];
  return r?.report ? { ...r.report, scannedAt: r.scanned_at.toISOString() } : null;
}

export async function getHolders(chain: string, address: string): Promise<HoldersSnapshot | null> {
  const { rows } = await db().query<{ holder_count: string | null; top10_pct: number | null; items: HoldersSnapshot["items"]; source: string; taken_at: Date }>(
    "SELECT holder_count, top10_pct, items, source, taken_at FROM holder_snapshots WHERE chain_id=$1 AND address=$2",
    [chain, address],
  );
  const r = rows[0];
  if (!r) return null;
  return { items: r.items, holderCount: r.holder_count == null ? null : Number(r.holder_count), top10Pct: r.top10_pct, source: r.source, updatedAt: r.taken_at.toISOString() };
}

/** Waktu snapshot holders terakhir per token (ms; 0 = belum pernah). */
export async function scanAges(keys: { chain: string; address: string }[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!keys.length) return out;
  const { rows } = await db().query<{ chain_id: string; address: string; taken_at: Date }>(
    `SELECT chain_id, address, taken_at FROM holder_snapshots WHERE (chain_id, address) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
    [keys.map((k) => k.chain), keys.map((k) => k.address)],
  );
  for (const r of rows) out.set(`${r.chain_id}:${r.address}`, r.taken_at.getTime());
  return out;
}
