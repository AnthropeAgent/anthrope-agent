"use client";

import { useEffect, useRef, useState } from "react";
import { CandlestickSeries, ColorType, createChart, HistogramSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { dataProvider, type CandleSeries } from "@/lib/data/provider";
import type { Candle, Token } from "@/lib/data/types";
import { useChannels } from "@/lib/data/ws";
import { savePreferences, useAccount } from "@/lib/auth/account";
import { fmtPrice } from "@/lib/format";

const INTERVALS: [string, number][] = [
  ["1s", 1],
  ["5s", 5],
  ["1m", 60],
  ["15m", 900],
  ["1h", 3600],
  ["4h", 14400],
  ["D", 86400],
];

/**
 * Data asli: bar baru/berubah datang lewat WS (channel candles:{chain}:{addr}:{iv}).
 * REST /ohlcv tetap di-poll sebagai cadangan (jarang), atau tiap 5 dtk selama worker belum punya datanya.
 */
const POLL_MS = 120_000;
const IV_NAME: Record<number, string> = { 60: "1m", 300: "5m", 900: "15m", 3600: "1h", 14400: "4h", 86400: "1d" };
const PENDING_POLL_MS = 5_000;

/**
 * Chart memakai TradingView Lightweight Charts (Apache-2.0).
 * Candle dari getCandles (/api/v1/.../ohlcv); bar terakhir mengikuti harga live.
 */
export function PriceChart({ token, livePrice, compact }: { token: Token; livePrice: number; compact?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lastRef = useRef<{ time: number; open: number; high: number; low: number; close: number } | null>(null);
  const [iv, setIv] = useState(900);
  // Interval tersimpan di akun (langkah 5): dipakai sekali saat preferensi pertama kali tersedia.
  const prefIv = useAccount().me?.preferences.chartInterval;
  const prefApplied = useRef(false);
  useEffect(() => {
    if (prefApplied.current || !prefIv) return;
    prefApplied.current = true;
    const s = Number(Object.keys(IV_NAME).find((k) => IV_NAME[Number(k)] === prefIv));
    if (s && !(compact && ![60, 900, 3600, 86400].includes(s))) setIv(s);
  }, [prefIv, compact]);
  const [mode, setMode] = useState<"price" | "mcap">("price");
  const [ohlc, setOhlc] = useState<string>("");
  const [series, setSeries] = useState<{ key: string; data: CandleSeries } | null>(null);
  const [reload, setReload] = useState(0);
  const fittedRef = useRef("");
  const tokenRef = useRef(token);
  const real = !!token.source && token.source !== "mock";
  const key = `${token.chain}:${token.address}:${iv}`;

  const mult = mode === "mcap" ? token.marketCap / token.price : 1;

  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#05060a" }, textColor: "#7f879c", fontFamily: "var(--font-roboto)", attributionLogo: false },
      grid: { vertLines: { color: "#11141c" }, horzLines: { color: "#11141c" } },
      rightPriceScale: { borderColor: "#1c2030" },
      timeScale: { borderColor: "#1c2030", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
      localization: { priceFormatter: (p: number) => fmtPrice(p, "") },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#00c78a",
      downColor: "#f4623f",
      borderVisible: false,
      wickUpColor: "#00c78a",
      wickDownColor: "#f4623f",
      priceFormat: { type: "custom", formatter: (p: number) => fmtPrice(p, ""), minMove: 1e-12 },
    });
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" } });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.subscribeCrosshairMove((p) => {
      const d = p.seriesData.get(candles) as { open: number; high: number; low: number; close: number } | undefined;
      if (d) setOhlc(`O ${fmtPrice(d.open, "")}  H ${fmtPrice(d.high, "")}  L ${fmtPrice(d.low, "")}  C ${fmtPrice(d.close, "")}`);
    });
    chartRef.current = chart;
    candleRef.current = candles;
    volRef.current = vol;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  // Ambil candle; data asli di-poll ulang (hanya saat tab terlihat).
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (document.visibilityState === "visible" || !timer) {
        const data = await dataProvider.getCandles(tokenRef.current, iv);
        if (!alive) return;
        setSeries({ key, data });
        if (!real || data.unsupported) return;
        timer = setTimeout(load, data.pending ? PENDING_POLL_MS : POLL_MS);
      } else timer = setTimeout(load, POLL_MS);
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, iv, real, reload]);

  // Bar live dari WS: ganti bar terakhir (waktu sama) atau tambah bar baru.
  const ivName = IV_NAME[iv];
  useChannels(
    real && ivName ? [`candles:${token.chain}:${token.address}:${ivName}`] : [],
    (_ch, data) => {
      const bar = data as Candle;
      setSeries((s) => {
        if (!s || s.key !== key) return s;
        const items = s.data.items;
        const last = items[items.length - 1];
        if (last && bar.time < last.time) return s;
        const next = last && bar.time === last.time ? [...items.slice(0, -1), bar] : [...items, bar];
        return { key, data: { ...s.data, items: next, pending: false } };
      });
    },
    () => setReload((n) => n + 1),
  );

  // Gambar candle. Zoom/geser user dipertahankan; fitContent hanya saat token/interval berganti.
  useEffect(() => {
    if (!candleRef.current || !volRef.current) return;
    const cs = series?.key === key ? series.data.items : [];
    const data = cs.map((c) => ({ time: c.time as UTCTimestamp, open: c.open * mult, high: c.high * mult, low: c.low * mult, close: c.close * mult }));
    candleRef.current.setData(data);
    volRef.current.setData(cs.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "rgba(0,199,138,0.35)" : "rgba(244,98,63,0.35)" })));
    lastRef.current = data[data.length - 1] ?? null;
    if (data.length && fittedRef.current !== key) {
      chartRef.current?.timeScale().fitContent();
      fittedRef.current = key;
    }
  }, [series, key, mult]);

  const current = series?.key === key ? series.data : null;
  const notice = !real
    ? null
    : !current
      ? "Memuat chart…"
      : current.unsupported
        ? "Interval detik butuh indexer sendiri (belum tersedia). Pilih 1m atau lebih."
        : current.pending
          ? "Mengambil candle dari GeckoTerminal… (±10–30 detik untuk token yang baru dibuka)"
          : current.items.length === 0
            ? "Belum ada data chart untuk pool utama token ini."
            : null;

  // Update bar terakhir dari harga live
  useEffect(() => {
    const last = lastRef.current;
    if (!last || !candleRef.current) return;
    const close = livePrice * mult;
    const now = Math.floor(Date.now() / 1000 / iv) * iv;
    const bar =
      now > last.time
        ? { time: now, open: last.close, high: Math.max(last.close, close), low: Math.min(last.close, close), close }
        : { ...last, high: Math.max(last.high, close), low: Math.min(last.low, close), close };
    candleRef.current.update({ ...bar, time: bar.time as UTCTimestamp });
    lastRef.current = bar;
  }, [livePrice, iv, mult]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1 text-xs">
        {INTERVALS.filter(([l]) => !compact || ["1m", "15m", "1h", "D"].includes(l)).map(([l, s]) => {
          const off = real && s < 60; // Mode A: resolusi terkecil 1 menit
          return (
            <button
              key={l}
              onClick={() => {
                setIv(s);
                prefApplied.current = true;
                if (IV_NAME[s]) savePreferences({ chartInterval: IV_NAME[s] });
              }}
              disabled={off}
              title={off ? "Butuh indexer sendiri (belum tersedia)" : undefined}
              className={`rounded px-2 py-1 ${iv === s ? "bg-panel-3 text-fg" : off ? "cursor-not-allowed text-muted/40" : "text-muted hover:text-fg"}`}
            >
              {l}
            </button>
          );
        })}
        <span className="mx-2 h-4 w-px bg-line" />
        <button onClick={() => setMode("price")} className={mode === "price" ? "text-link" : "text-muted hover:text-fg"}>
          Price
        </button>
        <span className="text-muted">/</span>
        <button onClick={() => setMode("mcap")} className={mode === "mcap" ? "text-link" : "text-muted hover:text-fg"}>
          MCap
        </button>
        <span className="num ml-auto hidden truncate text-muted lg:block">{ohlc}</span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="pointer-events-none absolute top-2 left-3 z-10 text-xs text-muted">
          <span className="text-soft">{token.symbol}/USD</span> · {INTERVALS.find(([, s]) => s === iv)?.[0]}
        </div>
        <div ref={el} className="absolute inset-0" />
        {notice && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6 text-center text-xs text-muted">{notice}</div>
        )}
      </div>
    </div>
  );
}
