"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogOut, Star, User } from "lucide-react";
import { ROUTES } from "@/config/brand";
import { logout, useAccount } from "@/lib/auth/account";
import { shortAddr } from "@/lib/format";

/** Tombol akun di topbar: LOG IN, atau alamat/nama + menu (watchlist, keluar). */
export function AccountButton({ onWatchlist }: { onWatchlist?: () => void }) {
  const { me } = useAccount();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  if (!me) {
    return (
      <Link
        href={`${ROUTES.login}?next=${encodeURIComponent(path)}`}
        aria-busy={me === undefined}
        className="flex h-8 items-center gap-2 rounded-md bg-panel-3 px-3 text-sm font-medium text-fg hover:bg-line-2"
      >
        <User size={15} /> <span className="hidden sm:inline">LOG IN</span>
      </Link>
    );
  }

  const wallet = me.wallets[0];
  const label = me.displayName ?? (wallet ? shortAddr(wallet.address, 4, 4) : "Akun");
  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 items-center gap-2 rounded-md bg-panel-3 px-3 text-sm font-medium text-fg hover:bg-line-2"
      >
        <span className="h-2 w-2 rounded-full bg-up" />
        <span className="num hidden sm:inline">{label}</span>
        <User size={15} className="sm:hidden" />
      </button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-50 mt-1 w-56 rounded-lg border border-line-2 bg-panel p-1 shadow-2xl">
          <div className="px-3 py-2 text-xs text-muted">
            {me.wallets.map((w) => (
              <div key={w.chainKind + w.address} className="num truncate">
                {w.chainKind === "solana" ? "Solana" : "EVM"} · {shortAddr(w.address, 6, 6)}
              </div>
            ))}
          </div>
          {onWatchlist && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onWatchlist();
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-panel-3"
            >
              <Star size={14} /> Watchlist
            </button>
          )}
          <button
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              await logout();
              router.refresh();
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-down hover:bg-panel-3"
          >
            <LogOut size={14} /> Keluar
          </button>
        </div>
      )}
    </div>
  );
}
