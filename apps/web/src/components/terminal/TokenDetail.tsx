"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Code2,
  Copy,
  ExternalLink,
  Flame,
  Globe,
  LayoutPanelLeft,
  Pencil,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Zap,
} from "lucide-react";
import { WatchStar } from "@/components/account/WatchStar";
import { CreateAlert } from "@/components/alerts/CreateAlert";
import { TokenAvatar } from "@/components/TokenAvatar";
import { chainById } from "@/config/chains";
import { ROUTES } from "@/config/brand";
import type { Holder, Token, TraderRow, Trade } from "@/lib/data/types";
import { AnalystPanel } from "@/components/agent/AnalystPanel";
import { tokenBrief } from "@/lib/agentContext";
import { useTokenScan, type ScanState } from "@/lib/data/scan";
import { useLiveTokens } from "@/lib/data/useLiveTokens";
import { useChannels } from "@/lib/data/ws";
import {
  fmtAge,
  fmtNum,
  fmtPct,
  fmtPrice,
  fmtUsd,
  pctClass,
  shortAddr,
} from "@/lib/format";
import { PriceChart } from "./PriceChart";
import { SwapWidget } from "./SwapWidget";

type Tab =
  | "trades"
  | "security"
  | "holders"
  | "top-traders"
  | "dev-tokens"
  | "markets"
  | "positions"
  | "ai";
const TABS: [Tab, string][] = [
  ["trades", "Trades"],
  ["ai", "AI Analyst"],
  ["security", "Security"],
  ["holders", "Holders"],
  ["top-traders", "Top Traders"],
  ["dev-tokens", "Dev Tokens"],
  ["markets", "Markets"],
  ["positions", "Positions"],
];
type Layout = "terminal" | "compact" | "classic";

export function TokenDetail({
  token: initial,
  trades: initialTrades,
  holders,
  traders,
  trending,
  fresh,
}: {
  token: Token;
  trades: Trade[];
  holders: Holder[];
  traders: TraderRow[];
  trending: Token[];
  fresh: Token[];
}) {
  const { tokens } = useLiveTokens([initial], 1500);
  const t = tokens[0];
  const [tab, setTab] = useState<Tab>("trades");
  const [layout, setLayout] = useState<Layout>("compact");
  const [layoutMenu, setLayoutMenu] = useState(false);
  const [chartPct, setChartPct] = useState(58);
  const [tf, setTf] = useState<"5m" | "1h" | "4h" | "24h">("24h");
  const leftRef = useRef<HTMLDivElement>(null);
  const prevPrice = useRef(t.price);
  const [dir, setDir] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    setDir(t.price >= prevPrice.current ? "up" : "down");
    prevPrice.current = t.price;
    document.title = `${t.symbol} ${fmtPrice(t.price)} | Terminal`;
  }, [t.price, t.symbol]);

  const startDrag = (e: React.PointerEvent) => {
    const box = leftRef.current?.getBoundingClientRect();
    if (!box) return;
    const move = (ev: PointerEvent) =>
      setChartPct(
        Math.min(85, Math.max(25, ((ev.clientY - box.top) / box.height) * 100)),
      );
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    e.preventDefault();
  };

  const chain = chainById(t.chain);
  const hasVolSplit = t.buyVolume24h != null && t.sellVolume24h != null;
  const buyPct = hasVolSplit
    ? (t.buyVolume24h! / Math.max(1e-9, t.buyVolume24h! + t.sellVolume24h!)) *
      100
    : null;
  const buyTxPct = t.txns24h > 0 ? (t.buys24h / t.txns24h) * 100 : null;
  const opt = (v: number | null, f: (n: number) => string) =>
    v == null ? "_" : f(v);
  // Token asli (dari provider): chart & trades asli (langkah 2), holders & security (langkah 7); top traders mock sampai langkah 8.
  const realToken = !!t.source && t.source !== "mock";
  const scan = useTokenScan(t, realToken);
  const holderCount = scan.holders?.holderCount ?? t.holders;
  const top10 = scan.holders?.top10Pct ?? t.top10Pct;

  // Trades: snapshot dari server, lalu transaksi baru lewat WS (channel trades:{chain}:{addr}).
  const router = useRouter();
  const [trades, setTrades] = useState(initialTrades);
  useEffect(() => setTrades(initialTrades), [initialTrades]);
  useChannels(
    realToken ? [`trades:${t.chain}:${t.address}`] : [],
    (_ch, data) => setTrades((prev) => mergeTrades(data as Trade[], prev)),
    () => router.refresh(),
  );
  const sampleTabs: Partial<Record<Tab, string>> = {
  };

  const side = (
    <aside
      className={`scrollbar-thin flex-col overflow-y-auto border-line ${layout === "classic" ? "order-first border-r" : "border-l"} w-full lg:flex lg:w-[340px] lg:shrink-0`}
    >
      <button className="m-3 flex items-center justify-between rounded-md bg-panel-3 px-3 py-2 text-xs text-muted hover:text-fg">
        Improve this token&apos;s appearance with a Banner! <Pencil size={12} />
      </button>
      <div className="flex items-start gap-3 px-3">
        <TokenAvatar
          symbol={t.symbol}
          color={t.logoColor}
          logoUrl={t.logoUrl}
          chain={t.chain}
          verified={t.verified}
          size={52}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-fg">{t.symbol}</span>
            {t.verified && (
              <span className="rounded bg-up/15 px-1.5 text-[10px] text-up">
                VERIFIED
              </span>
            )}
          </div>
          <div className="text-xs text-muted">
            {t.name} · <span className="text-link">{fmtAge(t.ageMinutes)}</span>{" "}
            · {chain?.name}
          </div>
        </div>
        <div className="relative flex flex-col gap-1.5">
          <WatchStar
            chain={t.chain}
            address={t.address}
            size={14}
            className="grid h-7 w-7 place-items-center rounded border border-line-2"
          />
          <CreateAlert chain={t.chain} address={t.address} price={t.price} symbol={t.symbol} />
          <button
            aria-label="Token layout"
            onClick={() => setLayoutMenu((v) => !v)}
            className="grid h-7 w-7 place-items-center rounded border border-line-2 text-muted hover:text-fg"
          >
            <LayoutPanelLeft size={14} />
          </button>
          {layoutMenu && (
            <div className="absolute top-full right-0 z-30 mt-1 w-36 rounded-lg border border-primary/50 bg-panel p-1 text-sm shadow-2xl">
              <div className="px-2 py-1 text-xs text-muted">Token Layout</div>
              {(["terminal", "compact", "classic"] as Layout[]).map((l) => (
                <button
                  key={l}
                  onClick={() => {
                    setLayout(l);
                    setLayoutMenu(false);
                  }}
                  className={`flex w-full justify-between rounded px-2 py-1.5 capitalize hover:bg-panel-3 ${layout === l ? "text-fg" : "text-muted"}`}
                >
                  {l} {layout === l && "✓"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3 px-3 text-muted">
        {t.socials.website && (
          <a
            href={t.socials.website}
            target="_blank"
            rel="noreferrer noopener nofollow"
            aria-label="Website"
            className="hover:text-fg"
          >
            <Globe size={15} />
          </a>
        )}
        {t.socials.x && (
          <a
            href={t.socials.x}
            target="_blank"
            rel="noreferrer noopener nofollow"
            aria-label="X"
            className="text-sm font-bold hover:text-fg"
          >
            𝕏
          </a>
        )}
        {t.socials.telegram && (
          <a
            href={t.socials.telegram}
            target="_blank"
            rel="noreferrer noopener nofollow"
            aria-label="Telegram"
            className="hover:text-fg"
          >
            <Send size={15} />
          </a>
        )}
        <a
          href={`${chain?.explorer}${t.address}`}
          target="_blank"
          rel="noreferrer"
          aria-label="Explorer"
        >
          <ExternalLink size={15} />
        </a>
        <button
          onClick={() => navigator.clipboard?.writeText(t.address)}
          className="ml-auto flex items-center gap-1 text-xs hover:text-fg"
        >
          {shortAddr(t.address)} <Copy size={12} />
        </button>
      </div>

      <div className="num mt-3 grid grid-cols-2 gap-2 px-3">
        <Stat
          label="Price USD"
          value={fmtPrice(t.price)}
          className={
            dir === "up"
              ? "text-up"
              : dir === "down"
                ? "text-down"
                : "text-fg"
          }
          big
        />
        <Stat
          label={`Price ${chain?.native}`}
          value={fmtPrice(t.priceNative, "")}
          big
        />
      </div>
      <div className="num mt-2 grid grid-cols-3 gap-2 px-3">
        <Stat label="Liquidity" value={fmtUsd(t.liquidity)} />
        <Stat label="Market Cap" value={fmtUsd(t.marketCap)} />
        <Stat label="FDV" value={fmtUsd(t.fdv)} />
      </div>
      <div className="num mx-3 mt-2 grid grid-cols-4 overflow-hidden rounded-md border border-line text-center text-xs">
        {(["5m", "1h", "4h", "24h"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTf(k)}
            className={`py-2 ${tf === k ? "bg-panel-3" : ""}`}
          >
            <div className="text-muted">{k}</div>
            <div className={pctClass(t.change[k])}>{fmtPct(t.change[k])}</div>
          </button>
        ))}
      </div>
      <div className="num mx-3 mt-2 space-y-3 rounded-md border border-line p-3 text-xs">
        <Flow
          label={`${tf} Vol`}
          total={fmtUsd(t.volume24h)}
          buy={opt(t.buyVolume24h, fmtUsd)}
          sell={opt(t.sellVolume24h, fmtUsd)}
          net={hasVolSplit ? fmtUsd(t.buyVolume24h! - t.sellVolume24h!) : "_"}
          pct={buyPct}
        />
        <Flow
          label={`${tf} Txns`}
          total={fmtNum(t.txns24h)}
          buy={fmtNum(t.buys24h)}
          sell={fmtNum(t.sells24h)}
          net={fmtNum(t.buys24h - t.sells24h)}
          pct={buyTxPct}
        />
        <div className="flex justify-between">
          <span className="text-muted">{tf} Traders</span>
          <span className="text-fg">{opt(t.traders24h, fmtNum)}</span>
        </div>
      </div>
      <div className="num mx-3 mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line text-center text-xs">
        {[
          ["Top 10 Holders", top10 == null ? "_" : `${top10.toFixed(2)}%`],
          ["Holders", holderCount == null ? "_" : fmtNum(holderCount)],
          ["Max Supply", fmtNum(t.maxSupply)],
          ["Circulating", fmtNum(t.circulating)],
          ["Markets", t.markets == null ? "_" : String(t.markets)],
          ["Launchpad", t.launchpad ?? "_"],
        ].map(([l, v]) => (
          <div key={l} className="bg-bg py-2">
            <div className="text-muted uppercase">{l}</div>
            <div className="mt-0.5 text-fg">{v}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 border-t border-line">
        <SwapWidget token={t} price={t.price} />
      </div>
      <div className="grid grid-cols-5 gap-1 border-t border-line p-3 text-[11px] text-muted">
        {[
          ["Info", Globe],
          ["Embed", Code2],
          ["Alert", Bell],
          ["Update", Pencil],
          ["API", Zap],
        ].map(([l, I]) => {
          const Icon = I as typeof Globe;
          return (
            <Link
              key={l as string}
              href={
                l === "Embed"
                  ? ROUTES.embed
                  : l === "API"
                    ? ROUTES.dataApi
                    : "#"
              }
              className="flex flex-col items-center gap-1 rounded py-1.5 hover:bg-panel-3 hover:text-fg"
            >
              <Icon size={14} />
              {l as string}
            </Link>
          );
        })}
      </div>
    </aside>
  );

  return (
    <div className="flex h-full flex-col">
      {/* Ticker strip */}
      <div className="no-scrollbar flex h-8 shrink-0 items-center gap-0 overflow-x-auto border-b border-line text-xs">
        <Strip
          icon={<Flame size={12} className="text-primary" />}
          label="Trending"
          items={trending}
        />
        <Strip
          icon={<Zap size={12} className="text-warn" />}
          label="New"
          items={fresh}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {layout === "classic" && (
          <div className="hidden lg:contents">{side}</div>
        )}
        <div
          ref={leftRef}
          className="flex min-h-[720px] min-w-0 flex-1 flex-col lg:min-h-0"
        >
          <div style={{ height: `${chartPct}%` }} className="relative min-h-0">
            <PriceChart
              token={t}
              livePrice={t.price}
              compact={layout === "compact"}
            />
          </div>
          <div
            onPointerDown={startDrag}
            className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center border-y border-line bg-panel"
          >
            <span className="h-0.5 w-8 rounded bg-line-2 group-hover:bg-primary" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="no-scrollbar flex shrink-0 items-center gap-4 overflow-x-auto border-b border-line px-3 text-sm">
              {TABS.map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`border-b-2 py-2 whitespace-nowrap ${tab === k ? "border-primary text-fg" : "border-transparent text-muted hover:text-fg"}`}
                >
                  {l}
                  {k === "holders" && holderCount != null && (
                    <span className="ml-1 text-muted">
                      ({fmtNum(holderCount)})
                    </span>
                  )}
                  {k === "security" && scan.report?.score != null && (
                    <span className={`ml-1 ${riskClass(scan.report.risk)}`}>
                      {scan.report.score}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
              {realToken && sampleTabs[tab] && (
                <SampleBadge
                  className="m-2"
                  text={`Data contoh, belum dari chain (tersambung di ${sampleTabs[tab]})`}
                />
              )}
              <BottomTab
                tab={tab}
                t={t}
                real={realToken}
                trades={trades}
                holders={holders}
                traders={traders}
                scan={scan}
              />
            </div>
          </div>
        </div>
        {layout !== "classic" ? side : <div className="lg:hidden">{side}</div>}
      </div>
    </div>
  );
}

const MAX_TRADES = 300;
/** Gabung trade baru ke daftar (tanpa duplikat), terbaru dulu. */
function mergeTrades(incoming: Trade[], current: Trade[]): Trade[] {
  const seen = new Set(current.map((x) => x.id));
  const fresh = incoming.filter((x) => !seen.has(x.id));
  if (!fresh.length) return current;
  return [...fresh, ...current]
    .sort((a, b) => b.time - a.time)
    .slice(0, MAX_TRADES);
}

function SampleBadge({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return (
    <div
      className={`w-fit rounded border border-warn/40 bg-warn/10 px-2 py-1 text-[11px] text-warn ${className}`}
    >
      {text}
    </div>
  );
}

function Strip({
  icon,
  label,
  items,
}: {
  icon: React.ReactNode;
  label: string;
  items: Token[];
}) {
  return (
    <div className="flex shrink-0 items-center border-r border-line">
      <span className="flex items-center gap-1 px-3 font-medium text-fg">
        {icon} {label}
      </span>
      {items.map((x) => (
        <Link
          key={x.address}
          href={ROUTES.token(x.chain, x.address)}
          className="flex items-center gap-1.5 px-2 whitespace-nowrap hover:bg-panel-2"
        >
          <TokenAvatar
            symbol={x.symbol}
            color={x.logoColor}
            logoUrl={x.logoUrl}
            size={16}
          />
          <span className="text-soft">{x.symbol}</span>
          <span className={`num ${pctClass(x.change["24h"])}`}>
            {fmtPct(x.change["24h"])}
          </span>
        </Link>
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  big,
  className = "text-fg",
}: {
  label: string;
  value: string;
  big?: boolean;
  className?: string;
}) {
  return (
    <div className="rounded-md border border-line px-2 py-2 text-center">
      <div className="text-[11px] text-muted uppercase">{label}</div>
      <div
        className={`mt-0.5 ${big ? "text-lg font-medium" : "text-sm"} ${className}`}
      >
        {value}
      </div>
    </div>
  );
}

function Flow({
  label,
  total,
  buy,
  sell,
  net,
  pct,
}: {
  label: string;
  total: string;
  buy: string;
  sell: string;
  net: string;
  pct: number | null;
}) {
  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        <div>
          <div className="text-muted">{label}</div>
          <div className="text-sm text-fg">{total}</div>
        </div>
        <div className="text-right">
          <div className="text-muted">Buy</div>
          <div className="text-up">{buy}</div>
        </div>
        <div className="text-right">
          <div className="text-muted">Sell</div>
          <div className="text-down">{sell}</div>
        </div>
        <div className="text-right">
          <div className="text-muted">Net</div>
          <div
            className={
              net === "_"
                ? "text-muted"
                : net.startsWith("-")
                  ? "text-down"
                  : "text-up"
            }
          >
            {net}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex h-1 overflow-hidden rounded">
        {pct == null ? (
          <div className="flex-1 bg-line-2" />
        ) : (
          <>
            <div className="bg-up" style={{ width: `${pct}%` }} />
            <div className="flex-1 bg-down" />
          </>
        )}
      </div>
    </div>
  );
}

const riskClass = (r: string) =>
  r === "low"
    ? "text-up"
    : r === "medium"
      ? "text-warn"
      : r === "high"
        ? "text-down"
        : "text-muted";
const RISK_LABEL: Record<string, string> = {
  low: "Risiko rendah",
  medium: "Risiko sedang",
  high: "Risiko tinggi",
  unknown: "Belum diketahui",
};

function BottomTab({
  tab,
  t,
  real,
  trades,
  holders: initialHolders,
  traders,
  scan,
}: {
  tab: Tab;
  t: Token;
  real: boolean;
  trades: Trade[];
  holders: Holder[];
  traders: TraderRow[];
  scan: ScanState;
}) {
  const th =
    "sticky top-0 bg-bg px-3 py-2 text-right font-normal text-muted first:text-left";
  const td = "border-t border-line/60 px-3 py-1.5 text-right first:text-left";
  if (tab === "ai") {
    const recent = trades.slice(0, 100);
    const buys = recent.filter((x) => x.side === "buy");
    const context = {
      page: "token detail",
      now: new Date().toISOString(),
      token: tokenBrief(t),
      sampleData: !real,
      securityReport: scan.report,
      topHolders: (scan.holders?.items ?? initialHolders).slice(0, 15).map((h) => ({ rank: h.rank, wallet: h.address, pct: h.pct, label: h.label ?? null, locked: h.locked ?? false })),
      holderCount: scan.holders?.holderCount ?? t.holders,
      recentTrades: {
        count: recent.length,
        buys: buys.length,
        sells: recent.length - buys.length,
        buyValueUsd: Math.round(buys.reduce((a, x) => a + x.valueUsd, 0)),
        sellValueUsd: Math.round(recent.filter((x) => x.side === "sell").reduce((a, x) => a + x.valueUsd, 0)),
        largest: [...recent].sort((a, b) => b.valueUsd - a.valueUsd).slice(0, 5).map((x) => ({ side: x.side, valueUsd: Math.round(x.valueUsd), wallet: x.maker, time: new Date(x.time * 1000).toISOString() })),
      },
      topTraders: traders.slice(0, 10).map((r) => ({ wallet: r.address, pnlUsd: Math.round(r.pnlUsd), roiPct: Math.round(r.roiPct), trades: r.trades })),
    };
    return (
      <div className="h-full min-h-[440px]">
        <AnalystPanel
          compact
          title={`AI Analyst · ${t.symbol}`}
          context={context}
          suggestions={[
            `Apa risiko terbesar ${t.symbol} berdasarkan security dan holders?`,
            "Apakah likuiditasnya cukup dibanding market cap dan volume?",
            "Siapa yang sedang membeli dan menjual besar akhir-akhir ini?",
            "Ringkas token ini dalam 5 poin.",
          ]}
        />
      </div>
    );
  }
  if (tab === "trades") {
    const explorer = chainById(t.chain)?.explorer ?? "";
    // Explorer menyimpan URL halaman token (".../token/"); halaman transaksi ada di ".../tx/".
    const txUrl = (hash: string) =>
      explorer.startsWith("http") && /^[0-9A-Za-z]+$/.test(hash)
        ? explorer.replace(/\/token\/$/, "/tx/") + hash
        : null;
    return (
      <>
        <table className="num w-full min-w-[640px] text-xs">
          <thead>
            <tr>
              {["Time", "Type", "Price", "Value", "Amount", "Maker"].map(
                (h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {trades.map((x) => {
              const href = txUrl(x.txHash);
              const time = new Date(x.time * 1000).toLocaleTimeString();
              return (
                <tr
                  key={x.id}
                  className={x.side === "buy" ? "text-up" : "text-down"}
                >
                  <td className={`${td} text-muted`} suppressHydrationWarning>
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="hover:text-primary"
                      >
                        {time}
                      </a>
                    ) : (
                      time
                    )}
                  </td>
                  <td className={`${td} capitalize`}>{x.side}</td>
                  <td className={td}>{fmtPrice(x.priceUsd)}</td>
                  <td className={td}>{fmtUsd(x.valueUsd)}</td>
                  <td className={td}>{fmtNum(x.amountToken)}</td>
                  <td className={`${td} text-soft`}>
                    <Link
                      href={ROUTES.wallet(x.maker)}
                      className="hover:text-primary"
                    >
                      {shortAddr(x.maker)}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {real && trades.length === 0 && (
          <div className="p-6 text-center text-xs text-muted">
            Mengambil trades dari GeckoTerminal… muncul otomatis dalam ±30
            detik.
          </div>
        )}
        {real && trades.length > 0 && (
          <div className="px-3 py-2 text-[11px] text-muted">
            {trades.length} transaksi terakhir di pool utama
            {t.mainPool ? ` (${shortAddr(t.mainPool)})` : ""} · sumber
            GeckoTerminal · transaksi baru masuk otomatis
          </div>
        )}
      </>
    );
  }
  if (tab === "holders") {
    const holders = real
      ? (scan.holders?.items ?? initialHolders)
      : initialHolders;
    return (
      <>
        <table className="num w-full min-w-[560px] text-xs">
          <thead>
            <tr>
              {["#", "Address", "%", "Amount", "Value"].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {holders.map((h) => (
              <tr key={h.rank}>
                <td className={`${td} text-muted`}>{h.rank}</td>
                <td className={td}>
                  <Link
                    href={ROUTES.wallet(h.address)}
                    className="text-soft hover:text-primary"
                  >
                    {shortAddr(h.address, 6, 4)}
                  </Link>
                  {h.label && (
                    <span className="ml-2 rounded bg-panel-3 px-1.5 text-[10px] text-muted">
                      {h.label}
                    </span>
                  )}
                </td>
                <td className={`${td} text-fg`}>{h.pct.toFixed(2)}%</td>
                <td className={`${td} text-soft`}>{fmtNum(h.amount)}</td>
                <td className={`${td} text-soft`}>{fmtUsd(h.valueUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {real && holders.length === 0 && (
          <div className="p-6 text-center text-xs text-muted">
            {scan.error
              ? "Data holders belum tersedia."
              : "Memindai holders… muncul otomatis dalam ±30 detik."}
          </div>
        )}
        {real && holders.length > 0 && scan.holders && (
          <div
            className="px-3 py-2 text-[11px] text-muted"
            suppressHydrationWarning
          >
            Top {holders.length} holder
            {scan.holders.holderCount != null
              ? ` dari ${fmtNum(scan.holders.holderCount)}`
              : ""}{" "}
            · top 10 (tanpa LP, burn, terkunci){" "}
            {scan.holders.top10Pct == null
              ? "_"
              : `${scan.holders.top10Pct.toFixed(2)}%`}{" "}
            · sumber{" "}
            {scan.holders.source === "solana-rpc" ? "Solana RPC" : "GoPlus"} ·
            diperbarui{" "}
            {scan.holders.updatedAt
              ? new Date(scan.holders.updatedAt).toLocaleTimeString()
              : "_"}
          </div>
        )}
      </>
    );
  }
  if (tab === "top-traders")
    return (
      <>
        <TradersTable rows={traders} />
        {real && (
          <div className="px-3 py-2 text-[11px] text-muted">
            {traders.length ? "PnL average-cost dari transaksi yang terpantau di pool utama (bukan riwayat penuh wallet)." : "Menghitung top traders dari transaksi terpantau… muncul setelah worker memproses trades (±1–2 menit)."}
          </div>
        )}
      </>
    );
  if (tab === "security" && real) return <SecurityPanel scan={scan} />;
  if (tab === "security") {
    const s = t.security;
    // null = belum dipindai (security scan = langkah 7), tampil netral, bukan "aman"
    const rows: [string, boolean | null, string][] = [
      [
        "Mint authority revoked",
        s.mintRevoked,
        s.mintRevoked == null ? "Belum dipindai" : s.mintRevoked ? "Yes" : "No",
      ],
      [
        "Freeze authority revoked",
        s.freezeRevoked,
        s.freezeRevoked == null
          ? "Belum dipindai"
          : s.freezeRevoked
            ? "Yes"
            : "No",
      ],
      [
        "LP burned / locked",
        s.lpBurnedPct == null ? null : s.lpBurnedPct >= 90,
        s.lpBurnedPct == null ? "Belum dipindai" : `${s.lpBurnedPct}%`,
      ],
      [
        "Honeypot",
        s.honeypot == null ? null : !s.honeypot,
        s.honeypot == null ? "Belum dipindai" : s.honeypot ? "Detected" : "No",
      ],
      [
        "Buy / Sell tax",
        s.buyTax == null || s.sellTax == null
          ? null
          : s.buyTax + s.sellTax === 0,
        s.buyTax == null || s.sellTax == null
          ? "Belum dipindai"
          : `${s.buyTax}% / ${s.sellTax}%`,
      ],
      [
        "Top 10 concentration",
        t.top10Pct == null ? null : t.top10Pct < 30,
        t.top10Pct == null ? "Belum dipindai" : `${t.top10Pct.toFixed(1)}%`,
      ],
    ];
    return (
      <div className="grid gap-2 p-3 sm:grid-cols-2">
        {rows.map(([l, ok, v]) => (
          <div
            key={l}
            className="flex items-center gap-3 rounded-md border border-line p-3 text-sm"
          >
            {ok == null ? (
              <ShieldQuestion size={18} className="text-muted" />
            ) : ok ? (
              <ShieldCheck size={18} className="text-up" />
            ) : (
              <ShieldAlert size={18} className="text-down" />
            )}
            <span className="flex-1 text-soft">{l}</span>
            <span
              className={
                ok == null ? "text-muted" : ok ? "text-up" : "text-down"
              }
            >
              {v}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid h-40 place-items-center text-sm text-muted">
      Tab ini akan terhubung ke backend pada Fase 3.
    </div>
  );
}

export function TradersTable({ rows }: { rows: TraderRow[] }) {
  const th =
    "sticky top-0 bg-bg px-3 py-2 text-right font-normal text-muted first:text-left";
  const td = "border-t border-line/60 px-3 py-2 text-right first:text-left";
  return (
    <table className="num w-full min-w-[720px] text-xs">
      <thead>
        <tr>
          {[
            "#",
            "Wallet",
            "PnL",
            "ROI",
            "Win rate",
            "Volume",
            "Trades",
            "Last active",
          ].map((h) => (
            <th key={h} className={th}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.rank} className="hover:bg-panel-2">
            <td className={`${td} text-muted`}>{r.rank}</td>
            <td className={td}>
              <Link
                href={ROUTES.wallet(r.address)}
                className="text-soft hover:text-primary"
              >
                {shortAddr(r.address, 5, 4)}
              </Link>
              {r.label && (
                <span className="ml-2 rounded bg-primary/15 px-1.5 text-[10px] text-primary">
                  {r.label}
                </span>
              )}
            </td>
            <td className={`${td} ${r.pnlUsd >= 0 ? "text-up" : "text-down"}`}>
              {fmtUsd(r.pnlUsd)}
            </td>
            <td className={`${td} ${pctClass(r.roiPct)}`}>
              {fmtPct(r.roiPct)}
            </td>
            <td className={`${td} text-fg`}>{r.winRate.toFixed(1)}%</td>
            <td className={`${td} text-soft`}>{fmtUsd(r.volumeUsd)}</td>
            <td className={`${td} text-soft`}>{fmtNum(r.trades)}</td>
            <td className={`${td} text-muted`}>
              {fmtAge(r.lastActiveMin)} ago
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SecurityPanel({ scan }: { scan: ScanState }) {
  const r = scan.report;
  if (!r)
    return (
      <div className="p-6 text-center text-xs text-muted">
        {scan.error
          ? "Security scan belum tersedia."
          : "Memindai kontrak & holder… hasil muncul otomatis dalam ±30 detik."}
      </div>
    );
  const order = { danger: 0, warn: 1, unknown: 2, ok: 3 } as const;
  const checks = [...r.checks].sort(
    (a, b) => order[a.status] - order[b.status],
  );
  return (
    <div className="p-3">
      <div className="mb-3 flex flex-wrap items-center gap-4 rounded-md border border-line p-3">
        <div className={`text-3xl font-bold ${riskClass(r.risk)}`}>
          {r.score ?? "?"}
        </div>
        <div className="text-sm">
          <div className={riskClass(r.risk)}>{RISK_LABEL[r.risk]}</div>
          <div className="text-xs text-muted">
            Skor 0–100 dari{" "}
            {r.checks.filter((c) => c.status !== "unknown").length} pemeriksaan
            · makin tinggi makin bersih
          </div>
        </div>
        <div
          className="ml-auto text-right text-[11px] text-muted"
          suppressHydrationWarning
        >
          Sumber {r.source === "solana-rpc" ? "Solana RPC" : "GoPlus"} ·{" "}
          {new Date(r.scannedAt).toLocaleString()}
          {r.owner && <div>Owner {shortAddr(r.owner)}</div>}
          {r.creator && <div>Creator {shortAddr(r.creator)}</div>}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {checks.map((c) => (
          <div
            key={c.key}
            className="flex items-center gap-3 rounded-md border border-line p-3 text-sm"
          >
            {c.status === "unknown" ? (
              <ShieldQuestion size={18} className="text-muted" />
            ) : c.status === "ok" ? (
              <ShieldCheck size={18} className="text-up" />
            ) : (
              <ShieldAlert
                size={18}
                className={c.status === "warn" ? "text-warn" : "text-down"}
              />
            )}
            <span className="flex-1 text-soft">{c.label}</span>
            <span
              className={
                c.status === "unknown"
                  ? "text-muted"
                  : c.status === "ok"
                    ? "text-up"
                    : c.status === "warn"
                      ? "text-warn"
                      : "text-down"
              }
            >
              {c.value}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-muted">
        Hasil otomatis dari data pihak ketiga, bukan audit dan bukan saran
        investasi. Selalu periksa sendiri sebelum membeli.
      </p>
    </div>
  );
}
