/**
 * Satu tempat untuk identitas brand. Ganti nilai di sini saja,
 * semua halaman (hub, terminal, peak, research) ikut berubah.
 */
export const BRAND = {
  name: "Anthrope Agent",
  tagline: "Crypto intelligence for internet capital markets",
  domain: "anthropeagent.com",
  products: {
    terminal: "Anthrope Terminal",
    data: "Anthrope Data",
    peak: "Anthrope Peak",
    research: "Anthrope Research",
  },
  /** Anthrope Agent adalah produk independen; AI Analyst memakai model Claude lewat API key milik user. */
  disclaimer: "Anthrope Agent is an independent product and is not affiliated with or endorsed by Anthropic. Claude is a trademark of Anthropic.",
  /** Isi dengan URL asli (npm package, repo GitHub, akun X). */
  socials: {
    npm: "https://www.npmjs.com/package/anthrope-agent-mcp",
    github: "https://github.com/AnthropeAgent/anthrope-agent",
    x: "https://x.com/anthropeagent",
    discord: "#",
    telegram: "#",
    linkedin: "#",
    youtube: "#",
  },
} as const;

/** Route semua produk: SATU domain, dibagi per path. */
export const ROUTES = {
  home: "/",
  terminal: "/terminal",
  trackers: "/terminal/trackers",
  agent: "/analyst",
  mcp: "/mcp",
  terminalAgent: "/terminal/agent",
  trenches: (chain = "solana") => `/terminal/${chain}/trenches`,
  token: (chain: string, address: string) => `/terminal/${chain}/token/${address}`,
  wallet: (address: string) => `/terminal/wallet/${address}`,
  perps: "/terminal/perps",
  supercharts: "/terminal/supercharts",
  multicharts: "/terminal/multicharts",
  findTrades: "/terminal/find-trades",
  embed: "/terminal/embed",
  peak: "/peak",
  peakApp: "/peak/app",
  research: "/research",
  researchAll: "/research/all",
  dataApi: "/data-api",
  blog: "/blog",
  about: "/about",
  careers: "/careers",
  login: "/login",
} as const;
