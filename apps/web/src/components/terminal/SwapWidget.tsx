"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Wallet, XCircle } from "lucide-react";
import { discoverWallets, type WalletOption } from "@/lib/auth/wallets";
import type { Token } from "@/lib/data/types";
import { fmtNum, shortAddr } from "@/lib/format";
import { friendlySwapError, setConnection, SWAP_CHAINS, swapApi, useConnections, type Balances, type SwapQuote } from "@/lib/swap";

const SLIPPAGES = [
  { bps: 100, label: "Auto" },
  { bps: 50, label: "0.5%" },
  { bps: 300, label: "3%" },
  { bps: 1000, label: "10%" },
];
const QUOTE_REFRESH_MS = 20_000;
const HIGH_IMPACT = 10;

type Phase =
  | { k: "idle" }
  | { k: "busy"; msg: string }
  | { k: "done"; ok: boolean; msg: string; url: string | null }
  | { k: "error"; msg: string };

/**
 * Buy/Sell non-custodial (langkah 6). Alur: quote → build (server memeriksa & mensimulasikan) →
 * tanda tangan & kirim di wallet user → track → status dari worker.
 */
export function SwapWidget({ token }: { token: Token; price: number }) {
  const cfg = SWAP_CHAINS[token.chain];
  const real = !!token.source && token.source !== "mock";
  const conns = useConnections();
  const conn = cfg ? conns[cfg.kind] : null;

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amt, setAmt] = useState("");
  const [slip, setSlip] = useState(100);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [bal, setBal] = useState<Balances | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [ackImpact, setAckImpact] = useState(false);
  const [picker, setPicker] = useState<WalletOption[] | null>(null);
  const reqId = useRef(0);

  const loadBalance = useCallback(async () => {
    if (!conn || !cfg) return setBal(null);
    setBal(await swapApi.balance(token.chain, conn.address, token.address).catch(() => null));
  }, [conn, cfg, token.chain, token.address]);
  useEffect(() => void loadBalance(), [loadBalance]);

  // Quote: ditunda 500 ms setelah mengetik, diperbarui tiap 20 dtk.
  const fetchQuote = useCallback(async () => {
    const id = ++reqId.current;
    if (!cfg || !real || !(Number(amt) > 0)) {
      setQuote(null);
      setQuoteErr(null);
      return null;
    }
    setQuoting(true);
    try {
      const q = await swapApi.quote({ chain: token.chain, side, token: token.address, amount: amt, slippageBps: slip });
      if (id === reqId.current) {
        setQuote(q);
        setQuoteErr(null);
      }
      return q;
    } catch (e) {
      if (id === reqId.current) {
        setQuote(null);
        setQuoteErr(friendlySwapError(e));
      }
      return null;
    } finally {
      if (id === reqId.current) setQuoting(false);
    }
  }, [cfg, real, amt, side, slip, token.chain, token.address]);

  useEffect(() => {
    setAckImpact(false);
    const t = setTimeout(fetchQuote, 500);
    const iv = setInterval(() => phase.k !== "busy" && fetchQuote(), QUOTE_REFRESH_MS);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
    // phase sengaja tidak jadi dependency: refresh tidak perlu di-reset saat status berubah
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchQuote]);

  if (!cfg || !real) {
    return <div className="p-4 text-sm text-muted">Swap belum tersedia untuk token ini{!real ? " (data contoh)" : ` (chain ${token.chain})`}.</div>;
  }

  const openPicker = () => discoverWallets((list) => setPicker(list.filter((w) => w.kind === cfg.kind)));
  const connect = async (w: WalletOption) => {
    setPicker(null);
    try {
      const { address } = await w.connect();
      setConnection(cfg.kind, { wallet: w, address });
    } catch (e) {
      setPhase({ k: "error", msg: friendlySwapError(e) });
    }
  };

  const execute = async () => {
    if (!conn) return;
    try {
      setPhase({ k: "busy", msg: "Menyiapkan & mensimulasikan transaksi…" });
      let q = quote && Date.parse(quote.expiresAt) - Date.now() > 3000 ? quote : await fetchQuote();
      if (!q) throw new Error(quoteErr ?? "Quote tidak tersedia");
      let b = await swapApi.build(q.quoteId, conn.address);

      if (b.needsApproval) {
        if (!conn.wallet.sendEvm || !conn.wallet.waitEvm) throw new Error("Wallet tidak mendukung approve");
        setPhase({ k: "busy", msg: `Setujui izin token di wallet (sejumlah ${q.amountInFormatted} ${token.symbol}, bukan unlimited)…` });
        const h = await conn.wallet.sendEvm(b.approvalTx);
        setPhase({ k: "busy", msg: "Menunggu izin terkonfirmasi…" });
        if (!(await conn.wallet.waitEvm(h))) throw new Error("Transaksi izin gagal");
        q = await fetchQuote();
        if (!q) throw new Error("Quote tidak tersedia");
        b = await swapApi.build(q.quoteId, conn.address);
        if (b.needsApproval) throw new Error("Izin token belum terbaca, coba lagi sebentar");
      }

      setPhase({ k: "busy", msg: "Simulasi lolos. Konfirmasi transaksi di wallet…" });
      const sig =
        b.kind === "solana"
          ? await conn.wallet.sendSolana!(b.unsignedTx as string)
          : await conn.wallet.sendEvm!(b.unsignedTx as Parameters<NonNullable<WalletOption["sendEvm"]>>[0]);
      if (b.orderId) await swapApi.track(b.orderId, sig).catch(() => {});

      setPhase({ k: "busy", msg: "Terkirim. Menunggu konfirmasi jaringan…" });
      const end = Date.now() + 120_000;
      let url: string | null = null;
      while (b.orderId && Date.now() < end) {
        await new Promise((r) => setTimeout(r, 3000));
        const o = await swapApi.order(b.orderId).catch(() => null);
        url = o?.explorerUrl ?? url;
        if (o?.status === "confirmed" || o?.status === "failed") {
          setPhase({ k: "done", ok: o.status === "confirmed", msg: o.status === "confirmed" ? "Swap berhasil" : "Swap gagal di jaringan", url });
          void loadBalance();
          return;
        }
      }
      setPhase({ k: "done", ok: true, msg: "Transaksi terkirim; konfirmasi masih diproses", url });
      void loadBalance();
    } catch (e) {
      setPhase({ k: "error", msg: friendlySwapError(e) });
      void fetchQuote();
    }
  };

  const busy = phase.k === "busy";
  const payBal = side === "buy" ? bal?.native : bal?.token;
  const highImpact = (quote?.priceImpactPct ?? 0) >= HIGH_IMPACT;
  const canSwap = !!conn && !!quote && !busy && (!highImpact || ackImpact);
  const sellPreset = (pct: number) => {
    if (!bal?.token || bal.token.raw === "0") return;
    const raw = (BigInt(bal.token.raw) * BigInt(pct)) / BigInt(100);
    const s = raw.toString().padStart(bal.token.decimals + 1, "0");
    const v = `${s.slice(0, s.length - bal.token.decimals)}.${s.slice(s.length - bal.token.decimals)}`.replace(/\.?0+$/, "");
    setAmt(v);
  };

  return (
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-2 rounded-md bg-panel-3 p-0.5 text-sm font-medium">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            disabled={busy}
            onClick={() => {
              setSide(s);
              setAmt("");
              setPhase({ k: "idle" });
            }}
            className={`rounded py-1.5 capitalize ${side === s ? (s === "buy" ? "bg-up text-black" : "bg-down text-black") : "text-muted"}`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 text-xs">
        <span className="text-fg">Market</span>
        <span className="text-muted/50" title="Limit order menyusul">
          Limit
        </span>
        <span className="num ml-auto text-muted">
          Bal: {payBal ? fmtNum(Number(payBal.formatted)) : conn ? "…" : "–"} {side === "buy" ? cfg.native : token.symbol}
        </span>
      </div>

      <label className="flex items-center rounded-md border border-line-2 bg-bg px-3 py-2 focus-within:border-primary">
        <span className="text-xs text-muted">AMOUNT</span>
        <input
          value={amt}
          disabled={busy}
          inputMode="decimal"
          onChange={(e) => {
            setAmt(e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 30));
            setPhase({ k: "idle" });
          }}
          placeholder="0"
          className="num min-w-0 flex-1 bg-transparent text-right text-fg outline-none"
        />
        <span className="ml-2 text-xs text-soft">{side === "buy" ? cfg.native : token.symbol}</span>
      </label>

      <div className="grid grid-cols-4 gap-1 text-xs">
        {side === "buy"
          ? cfg.buyPresets.map((v) => (
              <button key={v} disabled={busy} onClick={() => setAmt(v)} className="rounded border border-line py-1 text-soft hover:border-primary hover:text-fg">
                {v}
              </button>
            ))
          : [25, 50, 75, 100].map((p) => (
              <button key={p} disabled={busy || !bal?.token} onClick={() => sellPreset(p)} className="rounded border border-line py-1 text-soft hover:border-primary hover:text-fg disabled:opacity-40">
                {p}%
              </button>
            ))}
      </div>

      <div className="flex items-center gap-1 text-[11px]">
        <span className="mr-1 text-muted">Slippage</span>
        {SLIPPAGES.map((s) => (
          <button key={s.bps} disabled={busy} onClick={() => setSlip(s.bps)} className={`rounded px-2 py-1 ${slip === s.bps ? "bg-primary/20 text-primary-400" : "bg-panel-3 text-muted hover:text-fg"}`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="space-y-1 rounded-md bg-panel-2 px-3 py-2 text-xs">
        <Row label="You receive (est)">
          {quoting && !quote ? <Loader2 size={12} className="animate-spin" /> : quote ? `${fmtNum(Number(quote.amountOutFormatted))} ${side === "buy" ? token.symbol : cfg.native}` : "–"}
        </Row>
        <Row label="Minimum received">{quote ? `${fmtNum(Number(quote.minAmountOutFormatted))} ${side === "buy" ? token.symbol : cfg.native}` : "–"}</Row>
        <Row label="Price impact">
          <span className={highImpact ? "text-down" : (quote?.priceImpactPct ?? 0) >= 3 ? "text-warn" : ""}>{quote ? `${quote.priceImpactPct.toFixed(2)}%` : "–"}</span>
        </Row>
        <Row label="Route">{quote ? `${quote.aggregator === "jupiter" ? "Jupiter" : "KyberSwap"} · ${quote.route.slice(0, 2).join(", ") || "–"}` : "–"}</Row>
        <Row label="Platform fee">0%</Row>
      </div>

      {quoteErr && amt && <p className="text-xs text-down">{quoteErr}</p>}

      {highImpact && quote && (
        <label className="flex items-start gap-2 rounded-md border border-down/40 bg-down/10 p-2 text-xs text-down">
          <input type="checkbox" checked={ackImpact} onChange={(e) => setAckImpact(e.target.checked)} className="mt-0.5" />
          Price impact {quote.priceImpactPct.toFixed(1)}%: kamu bisa kehilangan banyak nilai. Saya paham risikonya.
        </label>
      )}

      {!conn ? (
        <div className="relative">
          <button onClick={openPicker} className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 font-bold text-ink">
            <Wallet size={16} /> CONNECT WALLET
          </button>
          {picker && (
            <div className="absolute right-0 bottom-full left-0 z-40 mb-1 rounded-lg border border-line-2 bg-panel p-1 shadow-2xl">
              {picker.length ? (
                picker.map((w) => (
                  <button key={w.id} onClick={() => connect(w)} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-fg hover:bg-panel-3">
                    {w.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element -- ikon data: URI dari wallet
                      <img src={w.icon} alt="" width={18} height={18} className="rounded" />
                    ) : (
                      <Wallet size={16} className="text-muted" />
                    )}
                    {w.name}
                  </button>
                ))
              ) : (
                <p className="p-3 text-xs text-muted">Tidak ada wallet {cfg.kind === "solana" ? "Solana" : "EVM"} terdeteksi. Pasang ekstensi wallet lalu muat ulang.</p>
              )}
              <button onClick={() => setPicker(null)} className="w-full py-1 text-center text-[11px] text-muted hover:text-fg">
                Tutup
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          disabled={!canSwap}
          onClick={execute}
          className={`flex w-full items-center justify-center gap-2 rounded-md py-2.5 font-bold text-black disabled:opacity-50 ${side === "buy" ? "bg-up" : "bg-down"}`}
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {side === "buy" ? `BUY ${token.symbol}` : `SELL ${token.symbol}`}
        </button>
      )}

      {conn && (
        <div className="flex items-center justify-between text-[11px] text-muted">
          <span className="num">
            {conn.wallet.name} · {shortAddr(conn.address, 4, 4)}
          </span>
          <button onClick={() => setConnection(cfg.kind, null)} disabled={busy} className="hover:text-fg">
            Putuskan
          </button>
        </div>
      )}

      {phase.k === "busy" && (
        <p className="flex items-center gap-2 text-xs text-soft">
          <Loader2 size={13} className="animate-spin" /> {phase.msg}
        </p>
      )}
      {phase.k === "error" && (
        <p role="alert" className="flex items-start gap-2 text-xs text-down">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {phase.msg}
        </p>
      )}
      {phase.k === "done" && (
        <p className={`flex items-center gap-2 text-xs ${phase.ok ? "text-up" : "text-down"}`}>
          {phase.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {phase.msg}
          {phase.url && (
            <a href={phase.url} target="_blank" rel="noreferrer noopener" className="ml-auto inline-flex items-center gap-1 text-link hover:underline">
              Explorer <ExternalLink size={11} />
            </a>
          )}
        </p>
      )}

      <p className="text-[10px] leading-relaxed text-muted">
        Non-custodial: transaksi dibangun & disimulasikan server, lalu ditandatangani di wallet kamu. Jumlah minimum dijamin kontrak aggregator; harga bisa berubah. Bukan saran investasi.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="num text-fg">{children}</span>
    </div>
  );
}
