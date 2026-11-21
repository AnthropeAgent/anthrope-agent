/**
 * Visual hero: bola cahaya di bawah, dengan dua koin 3D (Robinhood Chain & Ethereum) melayang.
 * Murni CSS + SVG inline, tanpa gambar eksternal.
 */

function Coin({ children, className = "", tilt }: { children: React.ReactNode; className?: string; tilt: string }) {
  return (
    <div className={`hero-coin absolute ${className}`} style={{ ["--tilt" as string]: tilt }}>
      <div className="hero-coin-face">
        <div className="hero-coin-rim">{children}</div>
      </div>
    </div>
  );
}

/** Ikon satu helai bulu (gaya Robinhood), digambar ulang sebagai bentuk sederhana. */
function Feather() {
  return (
    <svg viewBox="22 16 56 68" className="hero-emblem h-[62%] w-[62%]" aria-label="Robinhood Chain">
      <defs>
        <linearGradient id="emblem-rh" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c4d2ff" />
          <stop offset="1" stopColor="#6f86ff" />
        </linearGradient>
      </defs>
      <g fill="url(#emblem-rh)" strokeLinejoin="round">
        {/* ujung atas (bentuk panah) */}
        <path d="M46.5 33.5 L61.3 33.5 L62.2 36 L63 49.5 L72 35.5 Q74.5 27 71 20.5 Q67 18 62 21.3 Z" />
        {/* badan kiri */}
        <path d="M42.7 37.5 L57.3 37.5 L33.8 63 Q32.4 56 32.6 50 Q32.6 47 34.6 45 Z" />
        {/* badan tengah */}
        <path d="M58.6 42 L60 54 Q59.6 57.4 56.2 59.2 L38.6 68.6 Z" />
        {/* tangkai */}
        <path d="M26 79.6 L28.6 80.6 L58.6 42.4 L56.8 41 Z" />
      </g>
    </svg>
  );
}

function Ethereum() {
  return (
    <svg viewBox="0 0 100 100" className="hero-emblem h-[56%] w-[56%]" aria-label="Ethereum">
      <defs>
        <linearGradient id="emblem-eth" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c4d2ff" />
          <stop offset="1" stopColor="#6f86ff" />
        </linearGradient>
      </defs>
      <path d="M50 10 L76 52 L50 66 L24 52 Z" fill="url(#emblem-eth)" />
      <path d="M50 10 L50 66 L24 52 Z" fill="#ffffff" opacity="0.18" />
      <path d="M24 58 L50 72 L76 58 L50 92 Z" fill="url(#emblem-eth)" opacity="0.85" />
    </svg>
  );
}

export function HeroOrb() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[420px] overflow-hidden md:h-[460px]">
      {/* halo */}
      <div className="absolute bottom-[-520px] left-1/2 h-[900px] w-[1300px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(70,140,255,0.35),rgba(40,70,200,0.12)_60%,transparent)] blur-2xl" />
      {/* bola */}
      <div className="hero-orb absolute bottom-[-760px] left-1/2 h-[1000px] w-[1000px] -translate-x-1/2 rounded-full md:bottom-[-700px]" />
      {/* tekstur titik halus di permukaan bola */}
      <div className="hero-orb-dots absolute bottom-[-760px] left-1/2 h-[1000px] w-[1000px] -translate-x-1/2 rounded-full md:bottom-[-700px]" />

      <Coin tilt="-14deg" className="bottom-[120px] left-[calc(50%-165px)] h-[120px] w-[120px] md:bottom-[130px] md:left-[calc(50%-330px)] md:h-[190px] md:w-[190px]">
        <Feather />
      </Coin>
      <Coin tilt="18deg" className="bottom-[70px] left-[calc(50%+50px)] h-[105px] w-[105px] [animation-delay:-3s] md:bottom-[80px] md:left-[calc(50%+150px)] md:h-[170px] md:w-[170px]">
        <Ethereum />
      </Coin>

      {/* pudar ke latar di bawah */}
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-bg to-transparent" />
    </div>
  );
}
