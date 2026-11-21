"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Star } from "lucide-react";
import { ROUTES } from "@/config/brand";
import { inWatchlist, toggleWatch, useAccount } from "@/lib/auth/account";

/** Tombol ★: simpan token ke watchlist akun. Belum login → ke halaman login lalu kembali. */
export function WatchStar({ chain, address, size = 16, className = "" }: { chain: string; address: string; size?: number; className?: string }) {
  const { watchlist } = useAccount();
  const router = useRouter();
  const path = usePathname();
  const [busy, setBusy] = useState(false);
  const on = inWatchlist(watchlist, "token", chain, address);

  return (
    <button
      aria-label={on ? "Remove from watchlist" : "Add to watchlist"}
      aria-pressed={on}
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        e.preventDefault();
        setBusy(true);
        try {
          if ((await toggleWatch("token", chain, address)) === "login") router.push(`${ROUTES.login}?next=${encodeURIComponent(path)}`);
        } catch (err) {
          console.warn("watchlist:", err);
        } finally {
          setBusy(false);
        }
      }}
      className={`${on ? "text-warn" : "text-muted hover:text-fg"} ${className}`}
    >
      <Star size={size} fill={on ? "currentColor" : "none"} />
    </button>
  );
}
