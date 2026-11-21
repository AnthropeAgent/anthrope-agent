"use client";

/**
 * Klien WebSocket `/ws` (docs/api/websocket.md). Satu koneksi per tab, dipakai bersama semua komponen.
 * - Subscription di-ref-count: channel dilepas saat komponen terakhir berhenti mendengarkan.
 * - Reconnect otomatis (backoff 1–30 dtk) lalu subscribe ulang.
 * - Lompatan `seq` atau reconnect → callback `onResync`, supaya komponen mengambil ulang snapshot REST.
 */
import { useEffect, useRef, useState } from "react";

type Listener = { onData: (ch: string, data: unknown) => void; onResync?: () => void };
export type LiveStatus = "idle" | "connecting" | "open" | "closed";

const PING_MS = 25_000;

function wsUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  if (explicit) return explicit;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

class LiveSocket {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private lastSeq = new Map<string, number>();
  private retry = 0;
  private everOpened = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private statusListeners = new Set<(s: LiveStatus) => void>();
  status: LiveStatus = "idle";

  private setStatus(s: LiveStatus) {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  onStatus(l: (s: LiveStatus) => void) {
    this.statusListeners.add(l);
    return () => void this.statusListeners.delete(l);
  }

  private send(o: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(o));
  }

  private connect() {
    if (this.ws || typeof window === "undefined") return;
    this.setStatus("connecting");
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus("open");
      const channels = [...this.listeners.keys()];
      if (channels.length) this.send({ op: "subscribe", channels });
      this.pingTimer = setInterval(() => this.send({ op: "ping" }), PING_MS);
      // Setelah reconnect: data yang terlewat selama terputus diambil ulang lewat REST
      if (this.everOpened) for (const set of this.listeners.values()) for (const l of set) l.onResync?.();
      this.everOpened = true;
    };
    ws.onmessage = (ev) => {
      let m: { ch?: string; seq?: number; data?: unknown; op?: string; code?: string; message?: string };
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m.op === "error") console.warn(`[ws] ${m.code}: ${m.message}`);
      if (!m.ch) return;
      const set = this.listeners.get(m.ch);
      if (!set) return;
      const last = this.lastSeq.get(m.ch);
      if (m.seq != null) this.lastSeq.set(m.ch, m.seq);
      if (last != null && m.seq != null && m.seq !== last + 1) for (const l of set) l.onResync?.();
      for (const l of set) l.onData(m.ch, m.data);
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      this.ws = null;
      this.lastSeq.clear();
      this.setStatus("closed");
      if (!this.listeners.size) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }

  /** Dengarkan channel; return fungsi untuk berhenti. */
  listen(channels: string[], l: Listener): () => void {
    const added: string[] = [];
    for (const ch of channels) {
      let set = this.listeners.get(ch);
      if (!set) {
        this.listeners.set(ch, (set = new Set()));
        added.push(ch);
      }
      set.add(l);
    }
    if (added.length) this.send({ op: "subscribe", channels: added });
    if (!this.ws) {
      clearTimeout(this.retryTimer);
      this.connect();
    }
    return () => {
      const removed: string[] = [];
      for (const ch of channels) {
        const set = this.listeners.get(ch);
        if (!set?.delete(l) || set.size) continue;
        this.listeners.delete(ch);
        this.lastSeq.delete(ch);
        removed.push(ch);
      }
      if (removed.length) this.send({ op: "unsubscribe", channels: removed });
    };
  }
}

let socket: LiveSocket | null = null;
const live = () => (socket ??= new LiveSocket());

/**
 * Subscribe ke beberapa channel selama komponen hidup. `onData`/`onResync` boleh berubah tiap
 * render (disimpan di ref); subscription hanya diperbarui saat daftar channel berubah.
 */
export function useChannels(channels: string[], onData: (ch: string, data: unknown) => void, onResync?: () => void, enabled = true) {
  const ref = useRef({ onData, onResync });
  useEffect(() => {
    ref.current = { onData, onResync };
  });
  const key = channels.join("|");
  useEffect(() => {
    if (!enabled || !key) return;
    return live().listen(key.split("|"), {
      onData: (ch, d) => ref.current.onData(ch, d),
      onResync: () => ref.current.onResync?.(),
    });
  }, [key, enabled]);
}

export function useLiveStatus(): LiveStatus {
  const [s, setS] = useState<LiveStatus>("idle");
  useEffect(() => {
    setS(live().status);
    return live().onStatus(setS);
  }, []);
  return s;
}
