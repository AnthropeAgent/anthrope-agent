"use client";

/**
 * Alerts (langkah 11) di browser: CRUD rule + polling event untuk lonceng dan Notification browser.
 * Event "terakhir dilihat" disimpan per browser (localStorage), bukan di server.
 */
import { useEffect, useState } from "react";
import type { AlertEvent, AlertKind, AlertRule } from "@ot/types";
import { useAccount } from "./auth/account";

export class AlertApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
    throw new AlertApiError(res.status, e?.error?.message ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const listAlerts = () => call<{ items: AlertRule[]; max: number }>("GET", "/me/alerts");
export const createAlert = (b: { kind: AlertKind; chain: string; address: string; threshold: number; cooldownSec?: number }) => call<AlertRule>("POST", "/me/alerts", b);
export const setAlertActive = (id: string, active: boolean) => call<{ ok: true }>("PATCH", `/me/alerts/${id}`, { active });
export const deleteAlert = (id: string) => call<{ ok: true }>("DELETE", `/me/alerts/${id}`);
export const alertEvents = (after = 0) => call<{ items: AlertEvent[] }>("GET", `/me/alerts/events?after=${after}&limit=30`);

export const KIND_LABEL: Record<AlertKind, string> = {
  price_above: "Harga naik ke",
  price_below: "Harga turun ke",
  pct_change: "Bergerak ±% (1 jam)",
};

const SEEN = "alerts:seen";
const readSeen = () => {
  try {
    return Number(localStorage.getItem(SEEN) ?? 0) || 0;
  } catch {
    return 0;
  }
};

/** Polling event tiap 30 dtk selama login. Event baru → Notification browser bila diizinkan user. */
export function useAlertEvents() {
  const { me } = useAccount();
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [seen, setSeen] = useState(0);

  useEffect(() => {
    setSeen(readSeen());
    if (!me) {
      setEvents([]);
      return;
    }
    let stop = false;
    let last = 0;
    const tick = async () => {
      try {
        const { items } = await alertEvents(0);
        if (stop) return;
        const newest = items[0]?.id ?? 0;
        if (last && newest > last && typeof Notification !== "undefined" && Notification.permission === "granted") {
          for (const e of items.filter((x) => x.id > last).slice(0, 3)) new Notification("Alert", { body: e.message, tag: `alert-${e.id}` });
        }
        last = Math.max(last, newest);
        setEvents(items);
      } catch {
        /* sementara tidak tersedia; coba lagi siklus berikut */
      }
    };
    void tick();
    const id = setInterval(tick, 30_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [me]);

  const markSeen = () => {
    const top = events[0]?.id ?? 0;
    setSeen(top);
    try {
      localStorage.setItem(SEEN, String(top));
    } catch {
      /* abaikan */
    }
  };
  return { events, unread: events.filter((e) => e.id > seen).length, markSeen, loggedIn: !!me };
}
