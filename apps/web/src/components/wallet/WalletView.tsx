"use client";

/** Profil wallet (langkah 8): net worth, holdings, PnL dari transaksi terpantau, aktivitas. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { TokenAvatar } from "@/components/TokenAvatar";
import { ROUTES } from "@/config/brand";
import type { WalletProfile } from "@/lib/data/types";
import { fmtNum, fmtPrice, fmtUsd, shortAddr } from "@/lib/format";

const TABS = ["Holdings", "PnL", "Activity"] as const;
const EXPLORERS: Record<string, [string, string]> = {
  solana: ["Solscan", "https://solscan.io/account/"],
  base: ["BaseScan", "https://basescan.org/address/"],
  bsc: ["BscScan", "https://bscscan.com/address/"],
};
const pnlClass = (v: number) => (v > 0 ? "text-up" : v < 0 ? "text-down" : "text-soft");
const signedUsd = (v: number) => (v > 0 ? "+" : v < 0 ? "-" : "") + fmtUsd(Math.abs(v));

export function WalletView({ address }: { address: string }) {
  const [p, setP] = useState<WalletProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Holdings");

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let pending = true;
      try {
        const r = await fetch(`/api/v1/wallets/${address}`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as { profile: WalletProfile | null; pending: boolean };
        pending = body.pending;
        if (!stop && body.profile) setP(body.profile);
        if (!stop) setFailed(false);
      } catch {
        if (!stop) setFailed(true);
        pending = false;
      }
      if (!stop) timer = setTimeout(tick, pending ? 4_000 : 60_000);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [address]);

  const evm = address.startsWith("0x");
  const th = "sticky top-0 bg-bg px-3 py-2 text-right font-normal text-muted first:text-left";
  const td = "border-t border-line/60 px-3 py-1.5 text-right first:text-left";
  const stats: [string, string, string][] = [
    ["Net worth", p ? fmtUsd(p.netWorthUsd) : "_", "text-fg"],
    ["Total PnL", p ? signedUsd(p.pnl.totalUsd) : "_", p ? pnlClass(p.pnl.totalUsd) : "text-muted"],
    ["Realized", p ? signedUsd(p.pnl.realizedUsd) : "_", p ? pnlClass(p.pnl.realizedUsd) : "text-muted"],
    ["Unrealized", p ? signedUsd(p.pnl.unrealizedUsd) : "_", p ? pnlClass(p.pnl.unrealizedUsd) : "text-muted"],
    ["Win rate", p?.pnl.winRate == null ? "_" : `${p.pnl.winRate.toFixed(1)}%`, "text-fg"],
    ["Token traded", p ? String(p.pnl.tokensTraded) : "_", "text-fg"],
    ["Volume", p ? fmtUsd(p.pnl.volumeUsd) : "_", "text-fg"],
  ];

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="border-b border-line p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/20 text-sm font-bold text-primary">{address.slice(0, 2)}</div>
          <div>
            <div className="text-lg font-bold text-fg">{shortAddr(address, 6, 6)}</div>
            <div className="text-xs text-muted">{evm ? "EVM · Base, BNB Chain" : "Solana"}</div>
          </div>
          <button onClick={() => navigator.clipboard?.writeText(address)} className="ml-2 flex items-center gap-1 rounded border border-line-2 px-2 py-1 text-xs text-muted hover:text-fg">
            <Copy size={12} /> Copy
          </button>
          {(evm ? ["base", "bsc"] : ["solana"]).map((c) => (
            <a key={c} href={EXPLORERS[c][1] + address} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded border border-line-2 px-2 py-1 text-xs text-muted hover:text-fg">
              <ExternalLink size={12} /> {EXPLORERS[c][0]}
            </a>
          ))}
        </div>
        <div className="num mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {stats.map(([l, v, c]) => (
            <div key={l} className="rounded-md border border-line px-3 py-2">
              <div className="text-[11px] text-muted uppercase">{l}</div>
              <div className={`mt-0.5 text-sm font-medium ${c}`}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-4 border-b border-line px-4 text-sm">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`border-b-2 py-2 ${tab === t ? "border-primary text-fg" : "border-transparent text-muted hover:text-fg"}`}>
            {t}
            {p && <span className="ml-1 text-muted">({t === "Holdings" ? p.holdings.length : t === "PnL" ? p.tokens.length : p.activity.length})</span>}
          </button>
        ))}
      </div>

      {!p ? (
        <div className="p-10 text-center text-sm text-muted">{failed ? "Profil wallet belum tersedia. Coba lagi sebentar." : "Mengambil saldo dan transaksi wallet… (±5–15 detik)"}</div>
      ) : tab === "Holdings" ? (
        <table className="num w-full min-w-[640px] text-xs">
          <thead>
            <tr>
              {["Token", "Chain", "Amount", "Price", "Value"].map((h) => (
                <th key={h} className={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.holdings.map((h) => {
              const label = (
                <>
                  <TokenAvatar symbol={h.symbol} color="#e8d9bc" logoUrl={h.logoUrl ?? null} size={18} />
                  {h.symbol === "?" ? shortAddr(h.address) : h.symbol}
                </>
              );
              return (
                <tr key={`${h.chain}:${h.address}`} className="hover:bg-panel-2">
                  <td className={td}>
                    {h.native ? (
                      <span className="flex items-center gap-2 text-fg">{label}</span>
                    ) : (
                      <Link href={ROUTES.token(h.chain, h.address)} className="flex items-center gap-2 text-fg hover:text-primary">
                        {label}
                      </Link>
                    )}
                  </td>
                  <td className={`${td} text-muted`}>{h.chain}</td>
                  <td className={`${td} text-soft`}>{fmtNum(h.amount)}</td>
                  <td className={`${td} text-soft`}>{h.priceUsd == null ? "_" : fmtPrice(h.priceUsd)}</td>
                  <td className={`${td} text-fg`}>{h.valueUsd == null ? "_" : fmtUsd(h.valueUsd)}</td>
                </tr>
              );
            })}
            {!p.holdings.length && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted">
                  Tidak ada saldo yang terdeteksi.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      ) : tab === "PnL" ? (
        <table className="num w-full min-w-[720px] text-xs">
          <thead>
            <tr>
              {["Token", "Bought", "Sold", "Realized", "Unrealized", "PnL", "Trades"].map((h) => (
                <th key={h} className={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.tokens.map((t) => (
              <tr key={`${t.chain}:${t.address}`} className="hover:bg-panel-2">
                <td className={td}>
                  <Link href={ROUTES.token(t.chain, t.address)} className="text-fg hover:text-primary">
                    {t.symbol}
                  </Link>
                  <span className="ml-2 text-muted">{t.chain}</span>
                </td>
                <td className={`${td} text-soft`}>{fmtUsd(t.boughtUsd)}</td>
                <td className={`${td} text-soft`}>{fmtUsd(t.soldUsd)}</td>
                <td className={`${td} ${pnlClass(t.realizedUsd)}`}>{signedUsd(t.realizedUsd)}</td>
                <td className={`${td} ${pnlClass(t.unrealizedUsd)}`}>{signedUsd(t.unrealizedUsd)}</td>
                <td className={`${td} ${pnlClass(t.pnlUsd)}`}>{signedUsd(t.pnlUsd)}</td>
                <td className={`${td} text-soft`}>{t.trades}</td>
              </tr>
            ))}
            {!p.tokens.length && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted">
                  Belum ada transaksi wallet ini di token yang dipantau.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      ) : (
        <table className="num w-full min-w-[640px] text-xs">
          <thead>
            <tr>
              {["Time", "Token", "Type", "Price", "Value", "Amount"].map((h) => (
                <th key={h} className={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.activity.map((a) => (
              <tr key={`${a.chain}:${a.id}`} className={a.side === "buy" ? "text-up" : "text-down"}>
                <td className={`${td} text-muted`} suppressHydrationWarning>
                  {new Date(a.time * 1000).toLocaleString()}
                </td>
                <td className={td}>
                  <Link href={ROUTES.token(a.chain, a.token)} className="text-fg hover:text-primary">
                    {a.symbol}
                  </Link>
                </td>
                <td className={`${td} capitalize`}>{a.side}</td>
                <td className={td}>{fmtPrice(a.priceUsd)}</td>
                <td className={td}>{fmtUsd(a.valueUsd)}</td>
                <td className={td}>{fmtNum(a.amountToken)}</td>
              </tr>
            ))}
            {!p.activity.length && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted">
                  Belum ada aktivitas yang terpantau.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {p && (
        <div className="space-y-1 px-4 py-3 text-[11px] text-muted" suppressHydrationWarning>
          {p.notes.map((n) => (
            <div key={n}>• {n}</div>
          ))}
          <div>Diperbarui {new Date(p.updatedAt).toLocaleTimeString()}</div>
        </div>
      )}
    </div>
  );
}
