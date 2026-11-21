"use client";

import { useEffect, useState } from "react";
import { useAccount } from "@/lib/auth/account";
import { CHAINS } from "@/config/chains";
import type { SiteToken } from "@/lib/data/api";

const EMPTY: SiteToken = { chain: "solana", address: "", symbol: "", buyUrl: null };

/** Form admin: contract address (CA) token resmi yang tampil di hero beranda. */
export function AdminSiteToken() {
  const { me } = useAccount();
  const [t, setT] = useState<SiteToken>(EMPTY);
  const [current, setCurrent] = useState<SiteToken | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/v1/site/token", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { token: SiteToken | null }) => {
        setCurrent(j.token);
        if (j.token) setT(j.token);
      })
      .catch(() => setMsg({ ok: false, text: "Gagal memuat pengaturan CA" }));
  }, []);

  const send = async (body: unknown) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/admin/site/token", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      setCurrent(j.token);
      if (!j.token) setT(EMPTY);
      setMsg({ ok: true, text: j.token ? "CA tersimpan. Beranda menampilkannya dalam ±15 detik." : "CA dihapus dari hero." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const save = () => send({ chain: t.chain, address: t.address.trim(), symbol: t.symbol.trim().replace(/^\$/, ""), buyUrl: t.buyUrl?.trim() || null });
  const field = "w-full rounded-md border border-line-2 bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-primary";

  return (
    <section className="mx-auto max-w-6xl px-4 pt-8 text-soft">
      <div className="rounded-lg border border-line bg-panel p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold text-fg">Token CA · hero beranda</h2>
          <span className="text-xs text-muted">
            {current ? (
              <>
                Aktif: <span className="num text-soft">{current.address}</span> ({current.chain})
              </>
            ) : (
              "Belum diatur, hero tidak menampilkan CA."
            )}
          </span>
        </div>
        {me === null ? (
          <p className="mt-3 text-sm text-muted">Login dengan wallet admin untuk mengubah CA.</p>
        ) : (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-[150px_1fr_120px]">
              <label className="space-y-1 text-xs text-muted">
                Chain
                <select value={t.chain} onChange={(e) => setT({ ...t, chain: e.target.value })} className={field}>
                  {CHAINS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-muted">
                Contract address
                <input
                  value={t.address}
                  onChange={(e) => setT({ ...t, address: e.target.value })}
                  placeholder={t.chain === "solana" ? "Alamat mint base58" : "0x…"}
                  spellCheck={false}
                  className={`${field} num`}
                />
              </label>
              <label className="space-y-1 text-xs text-muted">
                Simbol
                <input value={t.symbol} onChange={(e) => setT({ ...t, symbol: e.target.value })} placeholder="ANTH" maxLength={16} className={field} />
              </label>
            </div>
            <label className="mt-3 block space-y-1 text-xs text-muted">
              Link chart / beli (opsional, https)
              <input value={t.buyUrl ?? ""} onChange={(e) => setT({ ...t, buyUrl: e.target.value })} placeholder="https://…" className={field} />
            </label>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button onClick={save} disabled={busy || !t.address.trim()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-ink disabled:opacity-50">
                Simpan CA
              </button>
              {current && (
                <button onClick={() => send({ clear: true })} disabled={busy} className="rounded-md border border-line-2 px-4 py-2 text-sm hover:text-fg disabled:opacity-50">
                  Hapus dari hero
                </button>
              )}
              {msg && <span className={`text-sm ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</span>}
            </div>
            <p className="mt-3 text-xs text-muted">Periksa alamat dua kali sebelum menyimpan: pengunjung akan menyalinnya untuk membeli token.</p>
          </>
        )}
      </div>
    </section>
  );
}
