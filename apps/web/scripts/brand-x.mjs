// Generates the Anthrope Agent "Sol" mark plus X (Twitter) profile picture and banner.
// Run: node scripts/brand-x.mjs  -> writes to public/brand/
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const P = (n) => fileURLToPath(new URL(n, OUT));

const OUT = new URL("../public/brand/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const C = {
  bg: "#0f0c09",
  panel: "#17120e",
  line: "#2a221a",
  gold: "#d9b56f",
  cream: "#efe4d0",
  fg: "#f3ecdf",
  muted: "#948a7b",
  line2: "#3b3127",
  warn: "#e8b30b",
  up: "#00c78a",
  down: "#f4623f",
};

/**
 * The mark: 12 faceted spear-rays detached from a core ring, alternating long/short,
 * with a keystone diamond in the middle (same keystone as the site logo).
 * Returns SVG markup centred at (cx, cy) with outer radius R.
 */
function mark(cx, cy, R, fill = "url(#mk)") {
  const rays = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = ((i * 360) / n - 90 + 7.5) * (Math.PI / 180);
    const long = i % 2 === 0;
    const r0 = R * 0.36; // ray starts away from the core: open "orbit" gap
    const r1 = R * (long ? 0.8 : 0.66); // shoulder
    const r2 = R * (long ? 1 : 0.8); // tip
    const w0 = R * 0.035;
    const w1 = R * (long ? 0.085 : 0.07);
    const px = (r, off) => {
      const ox = -Math.sin(a) * off, oy = Math.cos(a) * off;
      return `${(cx + Math.cos(a) * r + ox).toFixed(2)},${(cy + Math.sin(a) * r + oy).toFixed(2)}`;
    };
    rays.push(`<polygon points="${px(r0, -w0)} ${px(r1, -w1)} ${px(r2, 0)} ${px(r1, w1)} ${px(r0, w0)}"/>`);
  }
  const k = R * 0.12;
  return `
  <g fill="${fill}">${rays.join("")}</g>
  <circle cx="${cx}" cy="${cy}" r="${R * 0.25}" fill="none" stroke="${fill}" stroke-width="${R * 0.055}"/>
  <path d="M${cx} ${cy - k} L${cx + k * 0.72} ${cy} L${cx} ${cy + k} L${cx - k * 0.72} ${cy}Z" fill="${fill}"/>`;
}

const defs = `
  <linearGradient id="mk" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff6e3"/>
    <stop offset="0.5" stop-color="${C.cream}"/>
    <stop offset="1" stop-color="${C.gold}"/>
  </linearGradient>`;

// ---------- Logo (transparent + on dark) ----------
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>${defs}</defs>${mark(256, 256, 230)}</svg>`;

const logoDark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>${defs}
  <radialGradient id="bgg" cx="0.5" cy="0.42" r="0.7">
    <stop offset="0" stop-color="#2a1f15"/><stop offset="1" stop-color="${C.bg}"/>
  </radialGradient></defs>
<rect width="512" height="512" fill="url(#bgg)"/>${mark(256, 256, 180)}</svg>`;

// ---------- X profile picture 400x400 (crops to circle, so keep mark well inside) ----------
const pfp = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
<defs>${defs}
  <radialGradient id="bgg" cx="0.5" cy="0.45" r="0.65">
    <stop offset="0" stop-color="#2e2217"/><stop offset="1" stop-color="${C.bg}"/>
  </radialGradient>
  <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="${C.gold}" stop-opacity="0.22"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/>
  </radialGradient></defs>
<rect width="400" height="400" fill="url(#bgg)"/>
<circle cx="200" cy="200" r="170" fill="url(#glow)"/>
${mark(200, 200, 130)}</svg>`;

// ---------- X banner 1500x500 ----------
function grid(w, h, step) {
  let s = "";
  for (let x = 0; x <= w; x += step) s += `<line x1="${x}" y1="0" x2="${x}" y2="${h}"/>`;
  for (let y = 0; y <= h; y += step) s += `<line x1="0" y1="${y}" x2="${w}" y2="${y}"/>`;
  return s;
}

// deterministic candle series (seeded LCG) for the chart backdrop
function candles(x0, x1, yMid, amp, count) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const bw = (x1 - x0) / count;
  let price = yMid + amp * 0.6;
  let out = "", path = "";
  for (let i = 0; i < count; i++) {
    const drift = -amp * 0.018; // uptrend (y goes up)
    const open = price;
    const close = open + drift + (rnd() - 0.5) * amp * 0.16;
    const hi = Math.min(open, close) - rnd() * amp * 0.07;
    const lo = Math.max(open, close) + rnd() * amp * 0.07;
    const up = close < open;
    const col = up ? C.up : C.down;
    const x = x0 + i * bw + bw / 2;
    out += `<line x1="${x}" y1="${hi}" x2="${x}" y2="${lo}" stroke="${col}" stroke-width="1.4"/>`;
    out += `<rect x="${x - bw * 0.3}" y="${Math.min(open, close)}" width="${bw * 0.6}" height="${Math.max(1.5, Math.abs(close - open))}" fill="${col}"/>`;
    path += `${i ? "L" : "M"}${x.toFixed(1)} ${close.toFixed(1)} `;
    price = close;
  }
  return { out, path };
}

const ch = candles(820, 1480, 170, 280, 50);
const tickers = [
  ["BTC", "+2.41%", true], ["ETH", "+1.87%", true], ["SOL", "+4.12%", true], ["HYPE", "-0.93%", false],
  ["BNB", "+0.66%", true], ["SUI", "+3.08%", true], ["PUMP", "-2.15%", false], ["BASE", "+5.40%", true],
];
let tx = 330, tick = "";
for (const [s, p, u] of tickers) {
  tick += `<text x="${tx}" y="478" fill="${C.muted}">${s}</text><text x="${tx + s.length * 9.6 + 8}" y="478" fill="${u ? C.up : C.down}">${p}</text>`;
  tx += s.length * 9.6 + 8 + 70 + 34;
}

// Hero background (same photo as the site's RomanHero), cropped 3:1 around the figures.
const HERO = fileURLToPath(new URL("../public/hero/athens.jpg", import.meta.url));
const heroB64 = (
  await sharp(HERO).extract({ left: 0, top: 330, width: 2560, height: 853 }).resize(1500, 500).modulate({ saturation: 0.75 }).jpeg({ quality: 86 }).toBuffer()
).toString("base64");

const banner = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 500" width="1500" height="500">
<defs>${defs}
  <radialGradient id="g1" cx="0.22" cy="0.4" r="0.5">
    <stop offset="0" stop-color="#3a2a1a" stop-opacity="0.95"/><stop offset="1" stop-color="${C.bg}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="fadeR" x1="0" x2="1">
    <stop offset="0.52" stop-color="#fff" stop-opacity="0"/><stop offset="0.8" stop-color="#fff" stop-opacity="0.9"/><stop offset="1" stop-color="#fff" stop-opacity="1"/>
  </linearGradient>
  <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.gold}" stop-opacity="0.18"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="gridFade" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0.9"/><stop offset="1" stop-color="#fff" stop-opacity="0.15"/>
  </linearGradient>
  <linearGradient id="heroL" x1="0" x2="1">
    <stop offset="0" stop-color="${C.bg}" stop-opacity="0.9"/>
    <stop offset="0.5" stop-color="${C.bg}" stop-opacity="0.72"/>
    <stop offset="0.72" stop-color="${C.bg}" stop-opacity="0.45"/>
    <stop offset="1" stop-color="${C.bg}" stop-opacity="0.7"/>
  </linearGradient>
  <linearGradient id="heroV" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.bg}" stop-opacity="0.35"/>
    <stop offset="0.6" stop-color="${C.bg}" stop-opacity="0"/>
    <stop offset="1" stop-color="${C.bg}" stop-opacity="0.95"/>
  </linearGradient>
  <mask id="cm"><rect width="1500" height="500" fill="url(#fadeR)"/></mask>
  <mask id="gm"><rect width="1500" height="500" fill="url(#gridFade)"/></mask>
</defs>
<rect width="1500" height="500" fill="${C.bg}"/>
<image href="data:image/jpeg;base64,${heroB64}" width="1500" height="500" preserveAspectRatio="xMidYMid slice"/>
<rect width="1500" height="500" fill="url(#heroL)"/>
<rect width="1500" height="500" fill="url(#heroV)"/>
<g stroke="${C.line}" stroke-width="1" mask="url(#gm)">${grid(1500, 500, 50)}</g>
<rect width="1500" height="500" fill="url(#g1)"/>

<!-- chart backdrop -->
<g mask="url(#cm)"><g opacity="0.5">${ch.out}</g>
<path d="${ch.path} L1480 452 L820 452Z" fill="url(#area)"/>
<path d="${ch.path}" fill="none" stroke="${C.gold}" stroke-width="2" opacity="0.85"/></g>

<!-- AI agent x MCP terminal card -->
<g font-family="Consolas, 'JetBrains Mono', monospace" font-size="13">
  <rect x="1100" y="28" width="380" height="148" rx="8" fill="${C.panel}" fill-opacity="0.94" stroke="${C.line2}"/>
  <path d="M1100 58 H1480" stroke="${C.line2}"/>
  <circle cx="1118" cy="43" r="4" fill="${C.down}" opacity="0.8"/>
  <circle cx="1132" cy="43" r="4" fill="${C.warn}" opacity="0.8"/>
  <circle cx="1146" cy="43" r="4" fill="${C.up}" opacity="0.8"/>
  <text x="1162" y="47" fill="${C.muted}">anthrope-agent · mcp</text>
  <circle cx="1418" cy="43" r="3.5" fill="${C.up}"/>
  <text x="1427" y="47" fill="${C.up}">LIVE</text>
  <text x="1116" y="82" fill="${C.gold}">&gt;</text>
  <text x="1132" y="82" fill="${C.cream}">is $SOL safe to ape right now?</text>
  <text x="1132" y="104" fill="${C.muted}">└─ get_token_security</text><path d="M1442 99 l4 4 l7 -8" fill="none" stroke="${C.up}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="1132" y="124" fill="${C.muted}">└─ get_token_holders</text><path d="M1442 119 l4 4 l7 -8" fill="none" stroke="${C.up}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="1132" y="144" fill="${C.muted}">└─ top_traders</text><path d="M1442 139 l4 4 l7 -8" fill="none" stroke="${C.up}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M1121 155 l5 6 l-5 6 l-5 -6z" fill="${C.gold}"/><text x="1132" y="166" fill="${C.cream}">13 MCP tools · risk <tspan fill="${C.up}">LOW</tspan></text>
</g>

<!-- headline block, no mark (text stays above the avatar overlap at bottom-left) -->
<g>
  <rect x="110" y="72" width="280" height="32" rx="16" fill="${C.bg}" fill-opacity="0.55" stroke="${C.gold}" stroke-opacity="0.45"/>
  <circle cx="130" cy="88" r="4" fill="${C.up}"/>
  <circle cx="130" cy="88" r="8" fill="${C.up}" opacity="0.2"/>
  <text x="146" y="93" font-family="Consolas, 'JetBrains Mono', monospace" font-size="13" letter-spacing="2.5" fill="${C.cream}">AI AGENT <tspan fill="${C.gold}">×</tspan> MCP <tspan fill="${C.gold}">×</tspan> ONCHAIN</text>

  <text x="106" y="186" font-family="Georgia, 'Cormorant Garamond', serif" font-size="70" fill="${C.fg}">Read the chain</text>
  <text x="106" y="262" font-family="Georgia, 'Cormorant Garamond', serif" font-size="70" font-style="italic" fill="url(#mk)">before the crowd.</text>

  <line x1="110" y1="306" x2="150" y2="306" stroke="${C.gold}" stroke-width="1.5"/>
  <text x="164" y="312" font-family="Cinzel, 'Trajan Pro', Georgia, serif" font-size="19" font-weight="700" letter-spacing="9" fill="${C.cream}">ANTHROPE AGENT</text>
  <line x1="500" y1="298" x2="500" y2="316" stroke="${C.gold}" stroke-opacity="0.5"/><text x="516" y="311" font-family="Consolas, 'JetBrains Mono', monospace" font-size="13" letter-spacing="2" fill="#c9bea9">TERMINAL · DATA API · RESEARCH</text>
</g>

<!-- ticker strip -->
<rect y="452" width="1500" height="48" fill="${C.panel}" opacity="0.92"/>
<line x1="0" y1="452" x2="1500" y2="452" stroke="${C.line}"/>
<g font-family="Consolas, 'JetBrains Mono', monospace" font-size="16">${tick}</g>
</svg>`;

const files = { "logo-mark.svg": logoSvg, "logo-dark.svg": logoDark, "x-pfp.svg": pfp, "x-banner.svg": banner };
for (const [name, svg] of Object.entries(files)) writeFileSync(new URL(name, OUT), svg);

await sharp(Buffer.from(logoSvg)).resize(1024, 1024).png().toFile(P("logo-mark.png"));
await sharp(Buffer.from(logoDark)).resize(1024, 1024).png().toFile(P("logo-dark.png"));
await sharp(Buffer.from(pfp), { density: 192 }).resize(800, 800).png().toFile(P("x-pfp.png"));
await sharp(Buffer.from(banner), { density: 144 }).resize(1500, 500).png().toFile(P("x-banner.png"));
console.log("done");
