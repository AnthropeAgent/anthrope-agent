import { dataProvider } from "@/lib/data/provider";
import type { PerpsBucket, PerpsDoc } from "@/lib/data/types";
import { fmtNum, fmtPct, fmtPrice, fmtUsd } from "@/lib/format";

export const metadata = { title: "Perps Insights" };
export const dynamic = "force-dynamic";

function bias(long: number, short: number): [string, string] {
  if (long + short === 0) return ["–", "text-muted"];
  const r = long / (long + short);
  if (r > 0.65) return ["Very Bullish", "text-up"];
  if (r > 0.55) return ["Slightly Bullish", "text-up"];
  if (r >= 0.45) return ["Neutral", "text-soft"];
  if (r >= 0.35) return ["Slightly Bearish", "text-down"];
  return ["Very Bearish", "text-down"];
}

function Table({ title, rows }: { title: string; rows: PerpsBucket[] }) {
  const th = "px-3 py-2 text-right font-normal text-muted first:text-left";
  const td = "border-t border-line/60 px-3 py-2 text-right first:text-left";
  return (
    <section className="rounded-lg border border-line">
      <div className="border-b border-line px-4 py-2.5 text-sm font-bold text-fg">{title}</div>
      <div className="overflow-x-auto">
        <table className="num w-full min-w-[1040px] text-xs">
          <thead>
            <tr>
              {["Size", "Group", "Total Wallets", "Sampled", "In Positions", "Long", "Short", "Total Size", "In The Money", "Underwater", "Leverage", "Overall Bias"].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const [bl, bc] = bias(b.long, b.short);
              return (
                <tr key={b.group} className="hover:bg-panel-2">
                  <td className={`${td} text-soft`}>{b.range}</td>
                  <td className={`${td} text-fg`}>{b.group}</td>
                  <td className={td}>{fmtNum(b.wallets)}</td>
                  <td className={`${td} text-muted`}>{fmtNum(b.sampled)}</td>
                  <td className={td}>
                    {fmtNum(b.inPositions)} {b.sampled > 0 && <span className="text-muted">({((b.inPositions / b.sampled) * 100).toFixed(1)}%)</span>}
                  </td>
                  <td className={`${td} text-up`}>{fmtUsd(b.long)}</td>
                  <td className={`${td} text-down`}>{fmtUsd(b.short)}</td>
                  <td className={`${td} text-fg`}>{fmtUsd(b.long + b.short)}</td>
                  <td className={`${td} text-up`}>{fmtUsd(b.itm)}</td>
                  <td className={`${td} text-down`}>{fmtUsd(b.underwater)}</td>
                  <td className={td}>{b.leverage ? `${b.leverage.toFixed(1)}x` : "–"}</td>
                  <td className={`${td} ${bc}`}>{bl}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Heatmap({ d }: { d: PerpsDoc }) {
  const pnlGroups = d.pnl.map((p) => p.group);
  return (
    <section className="rounded-lg border border-line">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 text-sm">
        <span className="font-bold text-fg">MARKET POSITION HEATMAP</span>
        <span className="rounded bg-panel-3 px-2 py-0.5 text-xs text-muted">% long dari nilai posisi · equity × PnL all-time</span>
      </div>
      <div className="overflow-x-auto p-4">
        <div className="grid min-w-[760px] gap-1" style={{ gridTemplateColumns: `110px repeat(${pnlGroups.length}, 1fr)` }}>
          <span />
          {pnlGroups.map((g) => (
            <span key={g} className="text-center text-[11px] text-muted">
              {g}
            </span>
          ))}
          {d.equity.map((e) => (
            <div key={e.group} className="contents">
              <span className="self-center text-xs text-muted">{e.group}</span>
              {pnlGroups.map((g) => {
                const c = d.heat.find((h) => h.equity === e.group && h.pnl === g);
                const v = c?.longPct;
                const k = v == null ? 0 : (v - 50) / 50; // -1..1
                return (
                  <span
                    key={g}
                    title={c ? `${fmtUsd(c.sizeUsd)} posisi` : undefined}
                    className="num grid h-8 place-items-center rounded text-[11px] text-fg"
                    style={{ background: v == null ? "rgba(255,255,255,0.03)" : k >= 0 ? `rgba(0,199,138,${0.12 + k * 0.7})` : `rgba(244,98,63,${0.12 - k * 0.7})` }}
                  >
                    {v == null ? "–" : `${v.toFixed(0)}%`}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Markets({ d }: { d: PerpsDoc }) {
  const th = "px-3 py-2 text-right font-normal text-muted first:text-left";
  const td = "border-t border-line/60 px-3 py-2 text-right first:text-left";
  return (
    <section className="rounded-lg border border-line">
      <div className="border-b border-line px-4 py-2.5 text-sm font-bold text-fg">MARKETS · Hyperliquid</div>
      <div className="scrollbar-thin max-h-[420px] overflow-auto">
        <table className="num w-full min-w-[720px] text-xs">
          <thead className="sticky top-0 bg-bg">
            <tr>
              {["Market", "Mark", "24h", "Volume 24h", "Open Interest", "Funding /jam", "Max Lev"].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.markets.map((m) => (
              <tr key={m.coin} className="hover:bg-panel-2">
                <td className={`${td} text-fg`}>{m.coin}-PERP</td>
                <td className={td}>{fmtPrice(m.markPx)}</td>
                <td className={`${td} ${(m.change24hPct ?? 0) >= 0 ? "text-up" : "text-down"}`}>{fmtPct(m.change24hPct)}</td>
                <td className={td}>{fmtUsd(m.volume24hUsd)}</td>
                <td className={td}>{fmtUsd(m.openInterestUsd)}</td>
                <td className={`${td} ${m.fundingHourlyPct >= 0 ? "text-up" : "text-down"}`}>{m.fundingHourlyPct.toFixed(4)}%</td>
                <td className={td}>{m.maxLeverage}x</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function PerpsPage() {
  const d = await dataProvider.getPerps();
  if (!d)
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-muted">
        <div>
          <div className="text-fg">Data perps sedang disiapkan</div>
          <p className="mt-1 text-xs">Worker sedang mengambil pasar dan leaderboard Hyperliquid. Muat ulang dalam 1–2 menit.</p>
        </div>
      </div>
    );
  return (
    <div className="scrollbar-thin h-full space-y-4 overflow-auto p-3">
      <p className="text-xs text-muted">
        Sumber: Hyperliquid ({d.source === "mock" ? "data contoh" : "API publik"}). Total wallet dari leaderboard ({fmtNum(d.wallets)} akun); kolom posisi dihitung dari {fmtNum(d.sampled)} wallet sampel
        (maks. 300 akun teraktif per segmen equity), diperbarui bergiliran. Diperbarui {new Date(d.updatedAt).toLocaleTimeString("id-ID")}.
      </p>
      <Markets d={d} />
      <Heatmap d={d} />
      <Table title="POSITION DISTRIBUTION BY PNL (ALL-TIME)" rows={d.pnl} />
      <Table title="POSITION DISTRIBUTION BY EQUITY" rows={d.equity} />
    </div>
  );
}
