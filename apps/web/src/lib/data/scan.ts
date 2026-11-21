"use client";

/** Holders & security token asli (langkah 7): ambil dari api, ulangi selama worker masih memindai. */
import { useEffect, useState } from "react";
import type { HoldersBody } from "./api";
import type { SecurityReport, Token } from "./types";

export interface ScanState {
  holders: HoldersBody | null;
  report: SecurityReport | null;
  pending: boolean;
  error: boolean;
}

const PENDING_POLL_MS = 8_000;
const REFRESH_MS = 60_000;

export function useTokenScan(t: Pick<Token, "chain" | "address">, enabled: boolean): ScanState {
  const [s, setS] = useState<ScanState>({ holders: null, report: null, pending: enabled, error: false });
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const base = `/api/v1/tokens/${t.chain}/${t.address}`;
    const tick = async () => {
      let pending = true;
      try {
        const [h, r] = await Promise.all([
          fetch(`${base}/holders`, { cache: "no-store" }).then((x) => (x.ok ? (x.json() as Promise<HoldersBody>) : Promise.reject(x.status))),
          fetch(`${base}/security`, { cache: "no-store" }).then((x) => (x.ok ? (x.json() as Promise<{ report: SecurityReport | null; pending: boolean }>) : Promise.reject(x.status))),
        ]);
        pending = h.pending || r.pending;
        if (!stop) setS({ holders: h, report: r.report, pending, error: false });
      } catch {
        if (!stop) setS((p) => ({ ...p, pending: false, error: true }));
      }
      if (!stop) timer = setTimeout(tick, pending ? PENDING_POLL_MS : REFRESH_MS);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [t.chain, t.address, enabled]);
  return s;
}
