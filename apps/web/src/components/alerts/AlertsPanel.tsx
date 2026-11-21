"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BellRing, Trash2 } from "lucide-react";
import type { AlertEvent, AlertRule } from "@ot/types";
import { ROUTES } from "@/config/brand";
import { deleteAlert, KIND_LABEL, listAlerts, setAlertActive } from "@/lib/alerts";
import { fmtPrice } from "@/lib/format";

/** Panel kanan: notifikasi terbaru + daftar rule. */
export function AlertsPanel({ events, loggedIn, onOpen }: { events: AlertEvent[]; loggedIn: boolean; onOpen: () => void }) {
  const [rules, setRules] = useState<AlertRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [perm, setPerm] = useState<string>("default");

  useEffect(() => {
    onOpen();
    setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    if (!loggedIn) return;
    listAlerts()
      .then((r) => setRules(r.items))
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- muat sekali saat panel dibuka
  }, [loggedIn]);

  if (!loggedIn) return <p className="p-4 text-sm text-muted">Login dengan wallet untuk membuat alert harga. Buka halaman token lalu klik ikon lonceng.</p>;

  return (
    <div className="scrollbar-thin h-full space-y-4 overflow-y-auto p-3 text-xs">
      {perm === "default" && (
        <button onClick={() => Notification.requestPermission().then(setPerm)} className="flex w-full items-center justify-center gap-1.5 rounded-md border border-line-2 py-2 text-soft hover:text-fg">
          <BellRing size={13} /> Aktifkan notifikasi browser
        </button>
      )}
      <section>
        <div className="mb-1.5 text-muted">Notifikasi terbaru</div>
        {!events.length && <div className="text-muted">Belum ada alert yang terpicu.</div>}
        {events.map((e) => (
          <Link key={e.id} href={ROUTES.token(e.chain, e.address)} className="block border-b border-line/60 py-1.5 hover:text-fg">
            <div className="text-soft">{e.message}</div>
            <div className="text-[10px] text-muted">{new Date(e.firedAt).toLocaleString("id-ID")}</div>
          </Link>
        ))}
      </section>
      <section>
        <div className="mb-1.5 text-muted">Alert kamu {rules && `(${rules.length})`}</div>
        {error && <div className="text-down">{error}</div>}
        {rules?.length === 0 && <div className="text-muted">Belum ada. Buka halaman token lalu klik ikon lonceng.</div>}
        {rules?.map((r) => (
          <div key={r.id} className="flex items-center gap-2 border-b border-line/60 py-1.5">
            <Link href={ROUTES.token(r.chain, r.address)} className="min-w-0 flex-1 hover:text-fg">
              <div className="truncate text-soft">
                {r.symbol ?? r.address.slice(0, 6)} · {KIND_LABEL[r.kind]} {r.kind === "pct_change" ? `${r.threshold}%` : fmtPrice(r.threshold)}
              </div>
              <div className="text-[10px] text-muted">{r.lastFiredAt ? `terakhir ${new Date(r.lastFiredAt).toLocaleString("id-ID")}` : "belum pernah terpicu"}</div>
            </Link>
            <label className="flex items-center gap-1 text-[10px] text-muted">
              <input
                type="checkbox"
                checked={r.active}
                onChange={async (ev) => {
                  const active = ev.target.checked;
                  setRules((xs) => xs?.map((x) => (x.id === r.id ? { ...x, active } : x)) ?? null);
                  await setAlertActive(r.id, active).catch((e: Error) => setError(e.message));
                }}
              />
              aktif
            </label>
            <button
              aria-label="Hapus alert"
              onClick={async () => {
                await deleteAlert(r.id).catch((e: Error) => setError(e.message));
                setRules((xs) => xs?.filter((x) => x.id !== r.id) ?? null);
              }}
              className="text-muted hover:text-down"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
