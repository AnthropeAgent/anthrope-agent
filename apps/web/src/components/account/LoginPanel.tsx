"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2, Wallet } from "lucide-react";
import { AccountError, loginWithWallet, useAccount } from "@/lib/auth/account";
import { discoverWallets, type WalletOption } from "@/lib/auth/wallets";
import { shortAddr } from "@/lib/format";

/** Hanya path internal yang boleh jadi tujuan setelah login (cegah open redirect). */
function safeNext(v: string | null): string {
  return v && /^\/(?![/\\])[\w\-./?=&%#]*$/.test(v) ? v : "/terminal";
}

function friendly(e: unknown): string {
  if (e instanceof AccountError) {
    if (e.code === "RATE_LIMITED") return "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.";
    if (e.code === "SERVICE_UNAVAILABLE") return "Layanan akun sedang tidak tersedia. Coba lagi nanti.";
    if (e.status === 401) return "Tanda tangan tidak diterima atau kedaluwarsa. Silakan coba lagi.";
    return e.message;
  }
  const code = (e as { code?: number })?.code;
  const msg = (e as Error)?.message ?? "";
  if (code === 4001 || /reject|denied|cancel/i.test(msg)) return "Permintaan dibatalkan di wallet.";
  return "Gagal terhubung ke wallet. Coba lagi.";
}

export function LoginPanel() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = safeNext(sp.get("next"));
  const { me } = useAccount();
  const [wallets, setWallets] = useState<WalletOption[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => discoverWallets(setWallets), []);

  const login = async (w: WalletOption) => {
    setBusy(w.id);
    setError(null);
    try {
      await loginWithWallet(w);
      router.push(next);
      router.refresh();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(null);
    }
  };

  if (me) {
    return (
      <div className="mt-6 space-y-3 text-sm">
        <p className="text-soft">
          Sudah masuk sebagai <span className="num text-fg">{me.displayName ?? shortAddr(me.wallets[0]?.address ?? "", 4, 4)}</span>.
        </p>
        <button onClick={() => router.push(next)} className="w-full rounded-md bg-primary py-2.5 font-medium text-ink">
          Lanjutkan
        </button>
      </div>
    );
  }

  const groups: { kind: WalletOption["kind"]; label: string }[] = [
    { kind: "solana", label: "Solana" },
    { kind: "evm", label: "EVM (Base, BNB Chain, …)" },
  ];

  return (
    <div className="mt-6 space-y-4">
      {wallets === null ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" /> Mencari wallet…
        </div>
      ) : wallets.length === 0 ? (
        <div className="rounded-md border border-line-2 p-3 text-sm text-soft">
          Tidak ada wallet terdeteksi di browser ini. Pasang ekstensi wallet Solana (mis. Phantom, Solflare) atau EVM (mis. MetaMask,
          Rabby), lalu muat ulang halaman.
        </div>
      ) : (
        groups.map((g) => {
          const list = wallets.filter((w) => w.kind === g.kind);
          if (!list.length) return null;
          return (
            <div key={g.kind}>
              <div className="mb-1.5 text-[11px] tracking-wider text-muted uppercase">{g.label}</div>
              <div className="space-y-2">
                {list.map((w) => (
                  <button
                    key={w.id}
                    disabled={!!busy}
                    onClick={() => login(w)}
                    className="flex w-full items-center gap-3 rounded-md border border-line-2 px-3 py-2.5 text-left text-fg hover:border-primary disabled:opacity-60"
                  >
                    {w.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element -- ikon data: URI dari wallet
                      <img src={w.icon} alt="" width={22} height={22} className="rounded" />
                    ) : (
                      <Wallet size={20} className="text-muted" />
                    )}
                    <span className="flex-1">{w.name}</span>
                    {busy === w.id && <Loader2 size={15} className="animate-spin text-muted" />}
                  </button>
                ))}
              </div>
            </div>
          );
        })
      )}

      {busy && <p className="text-xs text-muted">Setujui permintaan tanda tangan di wallet. Ini hanya membuktikan kepemilikan alamat: tidak ada transaksi dan tidak ada biaya.</p>}
      {error && (
        <p role="alert" className="text-sm text-down">
          {error}
        </p>
      )}

      <div className="border-t border-line pt-4">
        <input
          type="email"
          disabled
          placeholder="Email (segera hadir)"
          className="w-full rounded-md border border-line-2 bg-bg px-3 py-2.5 text-fg outline-none disabled:opacity-50"
        />
      </div>
    </div>
  );
}
