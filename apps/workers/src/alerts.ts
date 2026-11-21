/**
 * Worker alerts (langkah 11): tiap siklus evaluasi rule aktif terhadap harga di Redis.
 * Kanal: "web" (event di alert_events, dibaca UI). Telegram/email belum dikonfigurasi.
 * Token target yang datanya tidak ada/basi diminta ke bridge (want) supaya ikut di-refresh.
 */
import { alerts, store, tokenKey } from "@ot/bridge";
import { postgres } from "@ot/db";
import type { AlertKind } from "@ot/types";

const MAX_RULES = 5_000;

interface Row {
  id: string;
  kind: AlertKind;
  chain_id: string;
  target: string;
  params: { threshold?: number };
  cooldown_sec: number;
  last_fired_at: Date | null;
}

export async function runAlerts(log: (m: string) => void): Promise<void> {
  const pg = postgres();
  if (!pg) return;
  const { rows } = await pg.query<Row>(
    `SELECT id, kind::text AS kind, chain_id, target, params, cooldown_sec, last_fired_at FROM alert_rules
      WHERE active AND kind IN ('price_above', 'price_below', 'pct_change') LIMIT ${MAX_RULES}`,
  );
  if (!rows.length) return;
  const keys = [...new Set(rows.map((r) => tokenKey(r.chain_id, r.target)))];
  const toks = new Map((await store.getTokens(keys)).map((t) => [tokenKey(t.chain, t.address), t]));
  const now = Date.now();
  for (const r of rows) {
    const t = toks.get(tokenKey(r.chain_id, r.target));
    if (!t || (t.updatedAt && now - Date.parse(t.updatedAt) > 90_000)) await store.requestToken(r.chain_id, r.target);
  }
  let fired = 0;
  for (const r of rows) {
    const t = toks.get(tokenKey(r.chain_id, r.target)) ?? null;
    const threshold = Number(r.params?.threshold ?? 0);
    const hit = alerts.evaluate({ kind: r.kind, threshold, cooldownSec: r.cooldown_sec, lastFiredAt: r.last_fired_at?.getTime() ?? null }, t, now);
    if (!hit) continue;
    // UPDATE bersyarat: bila dua worker berjalan, hanya satu yang memicu dalam satu cooldown.
    const claimed = await pg.query(
      "UPDATE alert_rules SET last_fired_at = now() WHERE id = $1 AND (last_fired_at IS NULL OR last_fired_at < now() - make_interval(secs => cooldown_sec))",
      [r.id],
    );
    if (!claimed.rowCount) continue;
    await pg.query("INSERT INTO alert_events (rule_id, payload, delivered) VALUES ($1, $2, $3)", [
      r.id,
      JSON.stringify({ message: hit.message, value: hit.value, threshold, symbol: t?.symbol ?? null, price: t?.price ?? null }),
      JSON.stringify({ web: "ok" }),
    ]);
    fired++;
  }
  if (fired) log(`alerts: ${fired} terpicu dari ${rows.length} rule`);
}
