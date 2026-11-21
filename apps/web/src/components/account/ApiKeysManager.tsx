"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound } from "lucide-react";
import { AccountButton } from "@/components/account/AccountButton";
import { BRAND } from "@/config/brand";
import { useAccount } from "@/lib/auth/account";

interface KeyInfo {
  id: string;
  name: string;
  prefix: string;
  plan: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
  usedThisMonth: number;
  monthlyCredits: number;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
  return j as T;
}

/** Langkah 13: buat/cabut API key (paket Free). Key asli hanya tampil sekali setelah dibuat. */
export function ApiKeysManager() {
  const { me } = useAccount();
  const [keys, setKeys] = useState<KeyInfo[] | null>(null);
  const [billing, setBilling] = useState<{ configured: boolean; message: string | null } | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    call<{ items: KeyInfo[] }>("GET", "/me/api-keys")
      .then((r) => setKeys(r.items))
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    call<{ configured: boolean; message: string | null }>("GET", "/billing").then(setBilling).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (me) load();
  }, [me, load]);

  return (
    <section className="rounded-2xl border border-white/10 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <KeyRound size={18} className="text-primary" />
        <h2 className="text-lg text-fg">API keys</h2>
        {billing && !billing.configured && <span className="rounded-full border border-white/15 px-2 py-0.5 text-xs text-dim">{billing.message}</span>}
        <div className="ml-auto">
          <AccountButton />
        </div>
      </div>
      {me === null && <p className="mt-4 text-sm">Login dengan wallet untuk membuat API key gratis (30K kredit/bulan, 1 request/detik).</p>}
      {me && (
        <div className="mt-4 space-y-3 text-sm">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                const r = await call<{ key: string }>("POST", "/me/api-keys", { name: name.trim() || "default" });
                setFresh(r.key);
                setName("");
                load();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Nama key, mis. bot-saya" className="min-w-0 flex-1 rounded-md border border-white/15 bg-transparent px-3 py-2 text-fg outline-none focus:border-primary" />
            <button className="rounded-md bg-primary px-4 py-2 font-medium text-ink">Buat key</button>
          </form>
          {fresh && (
            <div className="rounded-md border border-up/40 bg-up/5 p-3">
              <div className="text-xs text-up">Salin sekarang. Key ini tidak akan ditampilkan lagi.</div>
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-fg">{fresh}</code>
                <button aria-label="Salin key" onClick={() => navigator.clipboard?.writeText(fresh)} className="text-dim hover:text-fg">
                  <Copy size={14} />
                </button>
              </div>
            </div>
          )}
          {error && <div className="text-down">{error}</div>}
          <div className="divide-y divide-white/5 rounded-md border border-white/10">
            {keys?.length === 0 && <div className="p-3 text-dim">Belum ada key.</div>}
            {keys?.map((k) => (
              <div key={k.id} className="flex flex-wrap items-center gap-3 p-3">
                <span className="text-fg">{k.name}</span>
                <code className="font-mono text-xs text-dim">{k.prefix}…</code>
                <span className="text-xs text-dim">
                  {k.plan} · {k.usedThisMonth.toLocaleString()} / {k.monthlyCredits.toLocaleString()} kredit bulan ini
                  {k.lastUsedAt ? ` · terakhir dipakai ${new Date(k.lastUsedAt).toLocaleString("id-ID")}` : ""}
                </span>
                {k.revoked ? (
                  <span className="ml-auto text-xs text-down">dicabut</span>
                ) : (
                  <button
                    onClick={async () => {
                      if (!confirm(`Cabut key "${k.name}"? Aplikasi yang memakainya akan berhenti berfungsi.`)) return;
                      await call("DELETE", `/me/api-keys/${k.id}`).catch((e: Error) => setError(e.message));
                      load();
                    }}
                    className="ml-auto text-xs text-dim hover:text-down"
                  >
                    Cabut
                  </button>
                )}
              </div>
            ))}
          </div>
          <pre className="overflow-x-auto rounded-md bg-white/5 p-3 text-xs text-dim">curl -H &quot;x-api-key: ak_…&quot; https://{BRAND.domain}/api/v1/tokens?tab=trending</pre>
        </div>
      )}
    </section>
  );
}
