import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BRAND, ROUTES } from "@/config/brand";

export const metadata = { title: "MCP Server", description: "Connect Claude, Cursor and other MCP clients to live onchain market data." };

const TOOLS: [string, string][] = [
  ["search_tokens", "Find a token by symbol, name or contract address"],
  ["list_tokens", "Trending, new, top market cap and RWA tokens with filters"],
  ["get_token", "Price, market cap, FDV, liquidity, volume, price change"],
  ["get_token_security", "Mint/freeze authority, honeypot, taxes, LP lock"],
  ["get_token_holders", "Top 100 holders and concentration"],
  ["get_token_trades", "Latest swaps with size and wallet"],
  ["get_token_markets", "DEX pools, liquidity and volume per pool"],
  ["get_wallet", "Net worth, holdings, tracked PnL and activity"],
  ["top_traders", "Best traders globally or for one token"],
  ["pump_trenches", "pump.fun tokens by stage with bonding-curve progress"],
  ["perps_overview", "Hyperliquid markets and long/short distribution"],
  ["research_articles", "Published research and blog posts"],
  ["data_sources_status", "Data mode and freshness per chain"],
];

const PROMPTS: [string, string][] = [
  ["token_due_diligence", "Market, security, holders and trader flow for one token, ending with the main risks"],
  ["market_brief", "Snapshot of the onchain market from trending tokens, trenches and perps"],
];

const API_URL = `https://${BRAND.domain}/api/v1`;

const DESKTOP = `{
  "mcpServers": {
    "anthrope-agent": {
      "command": "npx",
      "args": ["-y", "anthrope-agent-mcp"],
      "env": {
        "ANTHROPE_API_KEY": "ak_...",
        "ANTHROPE_API_URL": "${API_URL}"
      }
    }
  }
}`;

const CODE = `claude mcp add anthrope-agent \\
  -e ANTHROPE_API_KEY=ak_... \\
  -e ANTHROPE_API_URL=${API_URL} \\
  -- npx -y anthrope-agent-mcp`;

function Code({ children }: { children: string }) {
  return <pre className="scrollbar-thin overflow-x-auto border border-line bg-bg p-4 text-[12.5px] leading-relaxed text-soft">{children}</pre>;
}

export default function McpPage() {
  return (
    <section className="mx-auto max-w-5xl px-4 pt-14 pb-24 md:pt-20">
      <div className="flex items-center gap-3 font-roman text-[11px] tracking-[0.25em] text-gold uppercase">
        <span className="h-px w-8 bg-current" /> Model Context Protocol
      </div>
      <h1 className="mt-4 font-serif text-5xl leading-tight text-fg md:text-6xl">Give your agent the market</h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-dim md:text-base">
        The Anthrope Agent MCP server lets Claude Desktop, Claude Code, Cursor and any MCP client read live onchain data: prices, liquidity, holders, security scans, wallets,
        top traders, pump.fun trenches and Hyperliquid perps. Every tool is read-only. It never signs or sends a transaction.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Link href={ROUTES.dataApi} className="inline-flex items-center gap-1.5 bg-primary px-5 py-2.5 font-roman text-xs font-semibold tracking-[0.14em] text-ink uppercase">
          Get an API key <ArrowUpRight size={14} />
        </Link>
        <Link href={ROUTES.agent} className="border border-line-2 px-5 py-2.5 font-roman text-xs tracking-[0.14em] text-fg uppercase hover:border-primary">
          Try the web analyst
        </Link>
      </div>

      <div className="mt-14 grid gap-10 md:grid-cols-[1fr_1fr]">
        <div>
          <h2 className="font-serif text-2xl text-fg">1. Create an API key</h2>
          <p className="mt-2 text-sm text-dim">
            Sign in and create a key on the <Link href={ROUTES.dataApi} className="text-link underline">Data API</Link> page. Each tool call uses one credit of your plan (Free: 30K
            credits a month).
          </p>
          <h2 className="mt-8 font-serif text-2xl text-fg">2. Add the server</h2>
          <p className="mt-2 mb-3 text-sm text-dim">Claude Code:</p>
          <Code>{CODE}</Code>
          <p className="mt-5 mb-3 text-sm text-dim">
            Claude Desktop (<span className="text-soft">claude_desktop_config.json</span>) or Cursor (<span className="text-soft">.cursor/mcp.json</span>):
          </p>
          <Code>{DESKTOP}</Code>
          <p className="mt-3 text-xs text-muted">Requires Node.js 20+. The key stays on your machine in the client config and is sent only to the Anthrope Agent API.</p>
          <h2 className="mt-8 font-serif text-2xl text-fg">3. Ask</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-soft">
            <li>“Is BONK on Solana safe? Check security and holder concentration.”</li>
            <li>“Which trending Base tokens have liquidity above $500K?”</li>
            <li>“What is wallet 0x… holding, and is it profitable?”</li>
            <li>“Are perps traders mostly long or short on ETH right now?”</li>
          </ul>
        </div>

        <div>
          <h2 className="font-serif text-2xl text-fg">Tools</h2>
          <div className="mt-3 border border-line">
            {TOOLS.map(([n, d]) => (
              <div key={n} className="flex flex-col gap-0.5 border-b border-line px-4 py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4">
                <code className="w-44 shrink-0 text-[12.5px] text-gold">{n}</code>
                <span className="text-sm text-dim">{d}</span>
              </div>
            ))}
          </div>
          <h2 className="mt-8 font-serif text-2xl text-fg">Prompts</h2>
          <div className="mt-3 border border-line">
            {PROMPTS.map(([n, d]) => (
              <div key={n} className="border-b border-line px-4 py-2.5 last:border-b-0">
                <code className="text-[12.5px] text-gold">{n}</code>
                <div className="text-sm text-dim">{d}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted">Market data comes from third parties and can be delayed. Responses are information, not investment advice.</p>
        </div>
      </div>
    </section>
  );
}
