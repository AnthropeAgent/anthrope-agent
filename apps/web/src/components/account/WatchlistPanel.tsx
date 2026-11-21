"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROUTES } from "@/config/brand";
import { useAccount } from "@/lib/auth/account";
import { fmtPct, fmtPrice, shortAddr } from "@/lib/format";
import { TokenAvatar } from "../TokenAvatar";
import { WatchStar } from "./WatchStar";

/** Isi panel Watchlist di terminal: token yang disimpan di akun, dengan harga dari cache. */
export function WatchlistPanel() {
  const { me, watchlist } = useAccount();
  const path = usePathname();

  if (me === undefined) return <div className="p-4 text-sm text-muted">Memuat…</div>;
  if (!me)
    return (
      <div className="space-y-3 p-4 text-sm text-muted">
        <p>Login untuk menyimpan token favorit di akunmu (tersedia di semua perangkat).</p>
        <Link href={`${ROUTES.login}?next=${encodeURIComponent(path)}`} className="inline-block rounded-md bg-primary px-3 py-1.5 font-medium text-ink">
          Log in
        </Link>
      </div>
    );
  const tokens = watchlist.filter((i) => i.kind === "token");
  if (!tokens.length) return <div className="p-4 text-sm text-muted">Belum ada token di watchlist. Klik ★ pada tabel atau halaman token untuk menambahkan.</div>;

  return (
    <ul className="max-h-full overflow-y-auto py-1">
      {tokens.map((i) => {
        const t = i.token;
        const ch = t?.change["24h"];
        return (
          <li key={i.chain + i.address} className="flex items-center gap-3 px-4 py-2 hover:bg-panel-2">
            <WatchStar chain={i.chain} address={i.address} size={14} />
            <Link href={ROUTES.token(i.chain, i.address)} className="flex min-w-0 flex-1 items-center gap-2">
              <TokenAvatar symbol={t?.symbol ?? "?"} color={t?.logoColor ?? "#444"} logoUrl={t?.logoUrl} chain={i.chain} size={24} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-fg">{t?.symbol ?? shortAddr(i.address)}</div>
                <div className="truncate text-xs text-muted">{t?.name ?? "Sedang diambil…"}</div>
              </div>
              {t && (
                <div className="num text-right text-xs">
                  <div className="text-fg">{fmtPrice(t.price)}</div>
                  <div className={ch == null ? "text-muted" : ch >= 0 ? "text-up" : "text-down"}>{ch == null ? "_" : fmtPct(ch)}</div>
                </div>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
