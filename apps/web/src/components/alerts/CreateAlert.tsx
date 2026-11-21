"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import type { AlertKind } from "@ot/types";
import { createAlert, KIND_LABEL } from "@/lib/alerts";
import { useAccount } from "@/lib/auth/account";

/** Tombol lonceng di header token + form kecil membuat alert. */
export function CreateAlert({ chain, address, price, symbol }: { chain: string; address: string; price: number; symbol: string }) {
  const { me } = useAccount();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AlertKind>("price_above");
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preset = (k: AlertKind) => {
    setKind(k);
    setValue(k === "pct_change" ? "10" : String(Number((price * (k === "price_above" ? 1.1 : 0.9)).toPrecision(4))));
  };

  return (
    <div className="relative">
      <button
        aria-label="Buat alert"
        onClick={() => {
          setOpen((v) => !v);
          setMsg(null);
          if (!value) preset(kind);
        }}
        className="grid h-7 w-7 place-items-center rounded border border-line-2 text-muted hover:text-fg"
      >
        <Bell size={14} />
      </button>
      {open && (
        <div className="absolute top-0 right-full z-40 mr-2 w-64 space-y-2 rounded-lg border border-line-2 bg-panel p-3 text-xs shadow-2xl">
          <div className="text-sm text-fg">Alert {symbol}</div>
          {me === null ? (
            <p className="text-muted">Login dengan wallet dulu (tombol di kanan atas) untuk menyimpan alert.</p>
          ) : (
            <form
              className="space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const threshold = Number(value);
                if (!(threshold > 0)) return setMsg("Masukkan angka lebih dari 0.");
                setBusy(true);
                try {
                  await createAlert({ kind, chain, address, threshold });
                  setMsg("Alert disimpan. Notifikasi muncul di panel Alerts.");
                } catch (err) {
                  setMsg((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <select value={kind} onChange={(e) => preset(e.target.value as AlertKind)} className="w-full rounded-md border border-line-2 bg-bg px-2 py-1.5 text-soft">
                {(Object.keys(KIND_LABEL) as AlertKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1 rounded-md border border-line-2 bg-bg px-2">
                <span className="text-muted">{kind === "pct_change" ? "±" : "$"}</span>
                <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className="num w-full bg-transparent py-1.5 text-fg outline-none" />
                {kind === "pct_change" && <span className="text-muted">%</span>}
              </div>
              <button disabled={busy} className="w-full rounded-md bg-primary py-1.5 font-medium text-ink disabled:opacity-50">
                Simpan alert
              </button>
            </form>
          )}
          {msg && <div className="text-soft">{msg}</div>}
        </div>
      )}
    </div>
  );
}
