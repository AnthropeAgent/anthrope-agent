import { SectionHeading } from "@/components/marketing/Chrome";
import { ContactForm } from "@/components/marketing/ContactForm";
import { BRAND } from "@/config/brand";
import { ApiKeysManager } from "@/components/account/ApiKeysManager";

export const metadata = { title: "Data API" };

const ENDPOINTS = [
  ["GET", "/api/v1/tokens?tab=trending&chain=solana", "Token list per chain (top MC, trending, new)"],
  ["GET", "/api/v1/tokens/{chain}/{address}", "Token overview: price, MC, liquidity, volume"],
  ["GET", "/api/v1/tokens/{chain}/{address}/ohlcv?interval=1m", "OHLCV candles 1m to 1D"],
  ["GET", "/api/v1/tokens/{chain}/{address}/trades", "Latest trades"],
  ["GET", "/api/v1/tokens/{chain}/{address}/holders", "Top holders & concentration"],
  ["GET", "/api/v1/tokens/{chain}/{address}/security", "Security score: mint/freeze authority, taxes, honeypot"],
  ["GET", "/api/v1/wallets/{address}", "Wallet net worth, holdings, observed PnL"],
  ["GET", "/api/v1/traders?scope=all", "Top traders"],
  ["GET", "/api/v1/trenches/solana", "pump.fun launches by stage"],
  ["GET", "/api/v1/perps", "Hyperliquid markets & position distribution"],
  ["WS", "/ws  price:{chain}:{address}", "Realtime price stream"],
];

const TIERS = [
  ["Free", "$0", ["30K credits / mo", "1 req/s", "REST only"]],
  ["Builder", "$99", ["5M credits / mo", "50 req/s", "WebSocket"]],
  ["Business", "$699", ["100M credits / mo", "250 req/s", "Priority support"]],
  ["Enterprise", "Custom", ["Dedicated infra", "SLA", "Custom endpoints"]],
] as const;

export default function DataApiPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-20 md:px-8">
      <SectionHeading eyebrow={BRAND.products.data} title="Decision-grade onchain data" desc="One API for prices, OHLCV, trades, wallets and token security. Send your key in the x-api-key header. Paket berbayar di bawah belum tersedia (billing belum dikonfigurasi)." />
      <div className="mt-12 overflow-hidden rounded-2xl border border-white/10">
        {ENDPOINTS.map(([m, p, d]) => (
          <div key={p} className="flex flex-col gap-1 border-b border-white/5 px-5 py-4 last:border-0 md:flex-row md:items-center md:gap-6">
            <span className={`w-12 font-mono text-xs ${m === "WS" ? "text-mcap" : "text-up"}`}>{m}</span>
            <code className="flex-1 font-mono text-sm text-fg">{p}</code>
            <span className="text-sm">{d}</span>
          </div>
        ))}
      </div>
      <div className="mt-12">
        <ApiKeysManager />
      </div>
      <div className="mt-16 grid gap-4 md:grid-cols-4">
        {TIERS.map(([n, p, f]) => (
          <div key={n} className="rounded-2xl border border-white/10 p-6">
            <div className="text-fg">{n}</div>
            <div className="mt-2 font-display text-3xl text-fg">{p}</div>
            <ul className="mt-4 space-y-2 text-sm">
              {f.map((x) => (
                <li key={x}>• {x}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div id="contact" className="mt-20 grid gap-10 md:grid-cols-2">
        <SectionHeading title="Talk to us" desc="Need custom endpoints or higher limits? Tell us what you are building." />
        <ContactForm />
      </div>
    </div>
  );
}
