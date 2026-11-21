// GitHub brand assets in the same style as the site and X banner:
//   github-social.png  1280x640  repo social preview (Settings > General > Social preview)
//   github-banner.png  1280x400  README header
//   github-avatar.png   500x500  account / organization avatar (GitHub crops it to a circle)
// Run: node scripts/brand-github.mjs  -> writes to public/brand/ and ../../.github/assets/
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = new URL("../public/brand/", import.meta.url);
const GH = new URL("../../../.github/assets/", import.meta.url);
mkdirSync(OUT, { recursive: true });
mkdirSync(GH, { recursive: true });

const C = {
  bg: "#0f0c09",
  panel: "#17120e",
  line: "#2a221a",
  line2: "#3b3127",
  gold: "#d9b56f",
  cream: "#efe4d0",
  fg: "#f3ecdf",
  muted: "#948a7b",
  dim: "#c9bea9",
  up: "#00c78a",
  down: "#f4623f",
  warn: "#e8b30b",
};
const SERIF = "Georgia, 'Cormorant Garamond', serif";
const ROMAN = "Cinzel, 'Trajan Pro', Georgia, serif";
const MONO = "Consolas, 'JetBrains Mono', monospace";

/** Same "Sol" mark as scripts/brand-x.mjs: 12 faceted rays, core ring, keystone diamond. */
function mark(cx, cy, R, fill = "url(#mk)") {
  const rays = [];
  for (let i = 0; i < 12; i++) {
    const a = ((i * 360) / 12 - 90 + 7.5) * (Math.PI / 180);
    const long = i % 2 === 0;
    const r0 = R * 0.36, r1 = R * (long ? 0.8 : 0.66), r2 = R * (long ? 1 : 0.8);
    const w0 = R * 0.035, w1 = R * (long ? 0.085 : 0.07);
    const px = (r, off) => {
      const ox = -Math.sin(a) * off, oy = Math.cos(a) * off;
      return `${(cx + Math.cos(a) * r + ox).toFixed(2)},${(cy + Math.sin(a) * r + oy).toFixed(2)}`;
    };
    rays.push(`<polygon points="${px(r0, -w0)} ${px(r1, -w1)} ${px(r2, 0)} ${px(r1, w1)} ${px(r0, w0)}"/>`);
  }
  const k = R * 0.12;
  return `<g fill="${fill}">${rays.join("")}</g>
  <circle cx="${cx}" cy="${cy}" r="${R * 0.25}" fill="none" stroke="${fill}" stroke-width="${R * 0.055}"/>
  <path d="M${cx} ${cy - k} L${cx + k * 0.72} ${cy} L${cx} ${cy + k} L${cx - k * 0.72} ${cy}Z" fill="${fill}"/>`;
}

const baseDefs = `
  <linearGradient id="mk" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff6e3"/><stop offset="0.5" stop-color="${C.cream}"/><stop offset="1" stop-color="${C.gold}"/>
  </linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="${C.gold}" stop-opacity="0.28"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/>
  </radialGradient>`;

function grid(w, h, step) {
  let s = "";
  for (let x = 0; x <= w; x += step) s += `<line x1="${x}" y1="0" x2="${x}" y2="${h}"/>`;
  for (let y = 0; y <= h; y += step) s += `<line x1="0" y1="${y}" x2="${w}" y2="${y}"/>`;
  return s;
}

/** Hero photo (public/hero/athens.jpg, Raphael, public domain) cropped to w x h around the figures. */
const HERO = fileURLToPath(new URL("../public/hero/athens.jpg", import.meta.url));
async function hero(w, h, top) {
  const meta = await sharp(HERO).metadata();
  const ch = Math.round((meta.width * h) / w);
  const t = Math.min(Math.max(0, top), meta.height - ch);
  const buf = await sharp(HERO).extract({ left: 0, top: t, width: meta.width, height: ch }).resize(w, h).modulate({ saturation: 0.72 }).jpeg({ quality: 86 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

/** Background stack shared by the social preview and banner. */
function backdrop(w, h, img, darkLeft = 0.9) {
  return `
  <defs>
    <linearGradient id="veilL" x1="0" x2="1">
      <stop offset="0" stop-color="${C.bg}" stop-opacity="${darkLeft}"/>
      <stop offset="0.55" stop-color="${C.bg}" stop-opacity="0.72"/>
      <stop offset="1" stop-color="${C.bg}" stop-opacity="0.55"/>
    </linearGradient>
    <linearGradient id="veilV" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.bg}" stop-opacity="0.45"/>
      <stop offset="0.55" stop-color="${C.bg}" stop-opacity="0"/>
      <stop offset="1" stop-color="${C.bg}" stop-opacity="0.95"/>
    </linearGradient>
    <linearGradient id="gridFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.8"/><stop offset="1" stop-color="#fff" stop-opacity="0.1"/>
    </linearGradient>
    <mask id="gm"><rect width="${w}" height="${h}" fill="url(#gridFade)"/></mask>
  </defs>
  <rect width="${w}" height="${h}" fill="${C.bg}"/>
  <image href="${img}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>
  <rect width="${w}" height="${h}" fill="url(#veilL)"/>
  <rect width="${w}" height="${h}" fill="url(#veilV)"/>
  <g stroke="${C.line}" stroke-width="1" mask="url(#gm)">${grid(w, h, 40)}</g>`;
}

/** Product chips in a row; returns markup and total width. */
function chips(x, y, labels, size = 14) {
  let s = "", cx = x;
  for (const l of labels) {
    const w = l.length * size * 0.62 + 30;
    s += `<rect x="${cx}" y="${y}" width="${w}" height="${size + 16}" rx="${(size + 16) / 2}" fill="${C.bg}" fill-opacity="0.55" stroke="${C.gold}" stroke-opacity="0.4"/>
    <text x="${cx + w / 2}" y="${y + size + 4}" text-anchor="middle" font-family="${MONO}" font-size="${size}" letter-spacing="1.5" fill="${C.cream}">${l}</text>`;
    cx += w + 12;
  }
  return s;
}

/** Terminal line with the MCP install command. */
function installLine(x, y, w, size = 17) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${size + 26}" rx="8" fill="${C.panel}" fill-opacity="0.94" stroke="${C.line2}"/>
  <text x="${x + 18}" y="${y + size + 7}" font-family="${MONO}" font-size="${size}" fill="${C.gold}">$</text>
  <text x="${x + 18 + size * 1.1}" y="${y + size + 7}" font-family="${MONO}" font-size="${size}" fill="${C.cream}">npx -y <tspan fill="${C.fg}" font-weight="700">anthrope-agent-mcp</tspan></text>
  <circle cx="${x + w - 62}" cy="${y + (size + 26) / 2}" r="4" fill="${C.up}"/>
  <text x="${x + w - 52}" y="${y + size + 6}" font-family="${MONO}" font-size="${size - 4}" fill="${C.up}">npm</text>`;
}

// ---------- Social preview 1280x640 ----------
const W = 1280, H = 640;
const social = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>${baseDefs}</defs>
${backdrop(W, H, await hero(W, H, 330))}
<circle cx="1010" cy="250" r="230" fill="url(#glow)"/>
${mark(1010, 250, 168)}

<g>
  <rect x="80" y="86" width="300" height="34" rx="17" fill="${C.bg}" fill-opacity="0.55" stroke="${C.gold}" stroke-opacity="0.45"/>
  <circle cx="101" cy="103" r="4" fill="${C.up}"/><circle cx="101" cy="103" r="8" fill="${C.up}" opacity="0.2"/>
  <text x="117" y="108" font-family="${MONO}" font-size="13.5" letter-spacing="2.5" fill="${C.cream}">AI AGENT <tspan fill="${C.gold}">×</tspan> MCP <tspan fill="${C.gold}">×</tspan> ONCHAIN</text>

  <text x="76" y="218" font-family="${ROMAN}" font-size="64" font-weight="700" letter-spacing="6" fill="${C.fg}">ANTHROPE</text>
  <text x="76" y="296" font-family="${ROMAN}" font-size="64" font-weight="700" letter-spacing="6" fill="url(#mk)">AGENT</text>

  <text x="80" y="352" font-family="${SERIF}" font-size="30" font-style="italic" fill="${C.cream}">Read the chain before the crowd.</text>
  <text x="80" y="392" font-family="${SERIF}" font-size="20" fill="${C.dim}">Live onchain data for traders and AI agents.</text>
  ${chips(80, 420, ["TERMINAL", "AI ANALYST", "DATA API", "MCP SERVER"], 13)}
</g>

${installLine(80, 500, 470)}
<text x="${W - 80}" y="534" text-anchor="end" font-family="${MONO}" font-size="16" fill="${C.dim}">github.com/<tspan fill="${C.cream}">AnthropeAgent/anthrope-agent</tspan></text>
<rect y="${H - 6}" width="${W}" height="6" fill="url(#mk)" opacity="0.85"/>
</svg>`;

// ---------- README banner 1280x400 ----------
const BW = 1280, BH = 400;
const banner = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BW} ${BH}" width="${BW}" height="${BH}">
<defs>${baseDefs}</defs>
${backdrop(BW, BH, await hero(BW, BH, 380), 0.92)}
<circle cx="1060" cy="190" r="170" fill="url(#glow)"/>
${mark(1060, 190, 124)}
<g>
  <text x="72" y="122" font-family="${ROMAN}" font-size="50" font-weight="700" letter-spacing="5" fill="${C.fg}">ANTHROPE <tspan fill="url(#mk)">AGENT</tspan></text>
  <text x="74" y="176" font-family="${SERIF}" font-size="34" font-style="italic" fill="${C.cream}">Read the chain before the crowd.</text>
  <line x1="76" y1="206" x2="116" y2="206" stroke="${C.gold}" stroke-width="1.5"/>
  <text x="130" y="211" font-family="${MONO}" font-size="14" letter-spacing="2.2" fill="${C.dim}">TERMINAL · AI ANALYST · DATA API · MCP SERVER</text>
  ${installLine(76, 262, 470, 17)}
</g>
<rect y="${BH - 5}" width="${BW}" height="5" fill="url(#mk)" opacity="0.85"/>
</svg>`;

// ---------- Avatar 500x500 (circle crop: keep the mark inside ~70% of the width) ----------
const avatar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="500" height="500">
<defs>${baseDefs}
  <radialGradient id="abg" cx="0.5" cy="0.45" r="0.68">
    <stop offset="0" stop-color="#30241a"/><stop offset="1" stop-color="${C.bg}"/>
  </radialGradient></defs>
<rect width="500" height="500" fill="url(#abg)"/>
<circle cx="250" cy="250" r="215" fill="url(#glow)"/>
<circle cx="250" cy="250" r="226" fill="none" stroke="${C.gold}" stroke-opacity="0.35" stroke-width="2"/>
${mark(250, 250, 160)}
</svg>`;

const out = [
  ["github-social", social, W, H],
  ["github-banner", banner, BW, BH],
  ["github-avatar", avatar, 500, 500],
];
for (const [name, svg, w, h] of out) {
  writeFileSync(new URL(`${name}.svg`, OUT), svg);
  const png = await sharp(Buffer.from(svg), { density: 144 }).resize(w, h).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(new URL(`${name}.png`, OUT), png);
  console.log(name, w, h, `${(png.length / 1024).toFixed(0)} KB`);
}
// README banner as JPEG (smaller), social preview PNG under GitHub's 1 MB limit.
await sharp(Buffer.from(banner), { density: 144 }).resize(BW, BH).jpeg({ quality: 88, mozjpeg: true }).toFile(fileURLToPath(new URL("banner.jpg", GH)));
await sharp(Buffer.from(social), { density: 144 }).resize(W, H).jpeg({ quality: 90, mozjpeg: true }).toFile(fileURLToPath(new URL("social-preview.jpg", GH)));
await sharp(Buffer.from(avatar), { density: 144 }).resize(256, 256).png({ compressionLevel: 9 }).toFile(fileURLToPath(new URL("logo.png", GH)));
console.log("done");
