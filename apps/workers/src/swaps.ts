/**
 * Tracker status swap (langkah 6): order `submitted` dicek ke RPC chain-nya
 * (Solana getSignatureStatuses, EVM eth_getTransactionReceipt) → confirmed / failed.
 * Order yang tidak muncul di chain dalam 2 jam ditandai failed (drop / expired).
 */
import { postgres } from "@ot/db";
import { isSwapChain, txStatuses } from "@ot/swap";

const BATCH = 50;
const GIVE_UP_MS = 2 * 3600_000;

export async function trackSwaps(log: (m: string) => void): Promise<void> {
  const pg = postgres();
  if (!pg) return;
  const { rows } = await pg.query<{ id: string; chain_id: string; tx_signature: string; updated_at: Date }>(
    `SELECT id, chain_id, tx_signature, updated_at FROM swap_orders
      WHERE status = 'submitted' AND tx_signature IS NOT NULL ORDER BY updated_at LIMIT $1`,
    [BATCH],
  );
  const byChain = new Map<string, typeof rows>();
  for (const r of rows) if (isSwapChain(r.chain_id)) byChain.set(r.chain_id, [...(byChain.get(r.chain_id) ?? []), r]);

  for (const [chain, list] of byChain) {
    let st: Awaited<ReturnType<typeof txStatuses>>;
    try {
      st = await txStatuses(fetch, chain as Parameters<typeof txStatuses>[1], list.map((r) => r.tx_signature));
    } catch (e) {
      log(`swap tracker ${chain}: ${(e as Error).message}`);
      continue;
    }
    for (const [i, r] of list.entries()) {
      const s = st[i];
      if (s === "pending" && Date.now() - r.updated_at.getTime() < GIVE_UP_MS) continue;
      const status = s === "pending" ? "failed" : s;
      const error = s === "pending" ? "tidak terkonfirmasi dalam 2 jam (drop/kedaluwarsa)" : s === "failed" ? "transaksi gagal di chain" : null;
      await pg.query("UPDATE swap_orders SET status = $2, error = $3, updated_at = now() WHERE id = $1 AND status = 'submitted'", [r.id, status, error]);
      log(`swap ${r.id.slice(0, 8)} ${chain}: ${status}`);
    }
  }
}
