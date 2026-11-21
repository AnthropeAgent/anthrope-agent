import type { Article } from "@/lib/data/types";

/**
 * Ilustrasi sampul artikel bergaya lukisan klasik, digambar dengan SVG (tanpa foto pihak lain).
 * Motif dipilih dari slug (stabil per artikel): barisan tiang + grafik naik, koin emas berprofil,
 * lengkung saat fajar, atau kuil dengan tiang berbentuk candlestick. Warna dasar mengikuti `hue` artikel.
 */
const ROMAN = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
];
const CAT: Record<Article["category"], string> = {
  blog: "Blog",
  "flagship-reports": "Flagship report",
  "insight-articles": "Insight",
};

function seedOf(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed: number) {
  let x = seed || 1;
  return () =>
    ((x =
      Math.imul(x ^ (x >>> 15), 2246822507) ^
      Math.imul(x ^ (x >>> 13), 3266489909)) >>>
      0) /
    4294967296;
}

export function CoverArt({
  a,
  labels = true,
}: {
  a: Article;
  labels?: boolean;
}) {
  const seed = seedOf(a.slug);
  const r = rng(seed);
  const id = `c${seed.toString(36)}`;
  const motif = (seed >>> 13) % 4;
  const h = a.hue;
  const sky = [
    `hsl(${(h + 330) % 360} 45% 9%)`,
    `hsl(${(h + 10) % 360} 48% 26%)`,
    `hsl(${(h + 30) % 360} 70% 52%)`,
  ];
  const stone = `hsl(${(h + 30) % 360} 35% 62%)`;
  const stoneDark = `hsl(${(h + 20) % 360} 30% 22%)`;
  const gold = "#e2bd74";
  const sunX = 140 + r() * 120;

  let scene: React.ReactNode;
  if (motif === 0) {
    // barisan tiang + grafik naik
    const pts = Array.from({ length: 9 }, (_, i) => [
      24 + i * 44,
      150 - i * 10 - r() * 26 + (i % 3 === 1 ? 14 : 0),
    ]);
    scene = (
      <>
        {Array.from({ length: 7 }, (_, i) => (
          <g key={i} fill={stone}>
            <rect x={30 + i * 56} y={86} width={22} height={112} />
            <rect x={24 + i * 56} y={80} width={34} height={8} />
            <rect x={24 + i * 56} y={196} width={34} height={8} />
            <rect
              x={30 + i * 56}
              y={86}
              width={8}
              height={112}
              fill={stoneDark}
              opacity={0.35}
            />
          </g>
        ))}
        <rect x={0} y={70} width={400} height={12} fill={stone} />
        <polyline
          points={pts.map((p) => p.join(",")).join(" ")}
          fill="none"
          stroke={gold}
          strokeWidth={3}
          strokeLinejoin="round"
        />
        {pts.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={i === pts.length - 1 ? 5 : 2.5}
            fill={gold}
          />
        ))}
      </>
    );
  } else if (motif === 1) {
    // koin emas berprofil dengan cincin daun salam
    scene = (
      <>
        <circle cx={200} cy={118} r={74} fill={gold} />
        <circle
          cx={200}
          cy={118}
          r={74}
          fill="none"
          stroke="#000"
          strokeOpacity={0.25}
          strokeWidth={3}
        />
        <circle
          cx={200}
          cy={118}
          r={62}
          fill="none"
          stroke="#7a5320"
          strokeOpacity={0.6}
          strokeDasharray="3 4"
        />
        <path
          d="M178 160 Q172 128 186 104 Q192 84 212 82 Q232 84 232 104 L240 112 L232 116 Q236 130 224 136 L220 160 Z"
          fill="#a7782f"
        />
        <path
          d="M186 92 Q200 74 222 82"
          fill="none"
          stroke="#6b4a1c"
          strokeWidth={4}
          strokeLinecap="round"
        />
        {Array.from({ length: 10 }, (_, i) => {
          const ang = Math.PI * 0.75 + (i / 9) * Math.PI * 1.5;
          const x = 200 + Math.cos(ang) * 68;
          const y = 118 + Math.sin(ang) * 68;
          return (
            <ellipse
              key={i}
              cx={x}
              cy={y}
              rx={3}
              ry={6}
              transform={`rotate(${(ang * 180) / Math.PI} ${x} ${y})`}
              fill="#7a5320"
              opacity={0.6}
            />
          );
        })}
      </>
    );
  } else if (motif === 2) {
    // lengkung saat fajar
    scene = (
      <>
        <path
          d="M60 225 V120 A140 140 0 0 1 340 120 V225 H300 V124 A100 100 0 0 0 100 124 V225 Z"
          fill={stone}
        />
        <path
          d="M60 225 V120 A140 140 0 0 1 340 120"
          fill="none"
          stroke="#000"
          strokeOpacity={0.25}
          strokeWidth={2}
        />
        <rect
          x={60}
          y={120}
          width={40}
          height={105}
          fill={stoneDark}
          opacity={0.35}
        />
        <rect
          x={0}
          y={200}
          width={400}
          height={25}
          fill={stoneDark}
          opacity={0.6}
        />
      </>
    );
  } else {
    // kuil: tiang-tiang berbentuk candlestick
    const bars = Array.from({ length: 8 }, () => [40 + r() * 60, r() > 0.4]);
    scene = (
      <>
        <path d="M70 92 L200 46 L330 92 Z" fill={stone} />
        <rect x={64} y={92} width={272} height={10} fill={stone} />
        {bars.map(([len, up], i) => {
          const x = 84 + i * 32;
          const top = 200 - (len as number);
          return (
            <g key={i}>
              <line
                x1={x + 7}
                x2={x + 7}
                y1={top - 12}
                y2={200}
                stroke={up ? "#7de0b5" : "#f08a6c"}
                strokeWidth={2}
              />
              <rect
                x={x}
                y={top}
                width={14}
                height={len as number}
                fill={up ? "#3fae86" : "#d4644a"}
              />
            </g>
          );
        })}
        <rect x={54} y={200} width={292} height={10} fill={stone} />
        <rect
          x={44}
          y={210}
          width={312}
          height={10}
          fill={stone}
          opacity={0.85}
        />
      </>
    );
  }

  return (
    <svg
      viewBox="0 0 400 225"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden
    >
      <defs>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky[0]} />
          <stop offset="0.6" stopColor={sky[1]} />
          <stop offset="1" stopColor={sky[2]} />
        </linearGradient>
        <radialGradient id={`${id}g`} cx={sunX / 400} cy="0.78" r="0.5">
          <stop offset="0" stopColor="#ffe4b0" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ff9a4a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}v`} cx="0.5" cy="0.5" r="0.75">
          <stop offset="0.6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.6" />
        </radialGradient>
        <filter id={`${id}n`}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency="1.1"
            numOctaves="2"
            stitchTiles="stitch"
          />
          <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.4  0 0 0 0 0.3  0 0 0 0.12 0" />
        </filter>
      </defs>
      <rect width="400" height="225" fill={`url(#${id}s)`} />
      <rect width="400" height="225" fill={`url(#${id}g)`} />
      {scene}
      <rect width="400" height="225" fill={`url(#${id}v)`} />
      <rect width="400" height="225" filter={`url(#${id}n)`} />
      {labels && (
        <>
          <text
            x="16"
            y="26"
            fill="#f6e7cc"
            fillOpacity="0.85"
            fontFamily="var(--font-cinzel), Georgia, serif"
            fontSize="11"
            letterSpacing="2.5"
          >
            {CAT[a.category].toUpperCase()}
          </text>
          <text
            x="384"
            y="26"
            textAnchor="end"
            fill="#f6e7cc"
            fillOpacity="0.6"
            fontFamily="var(--font-cinzel), Georgia, serif"
            fontSize="11"
            letterSpacing="2"
          >
            № {ROMAN[seed % 12]}
          </text>
        </>
      )}
    </svg>
  );
}
