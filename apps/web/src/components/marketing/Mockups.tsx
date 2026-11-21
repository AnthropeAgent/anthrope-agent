/** Mockup layar terminal yang digambar dengan CSS (tanpa aset gambar pihak lain). */

function Bars({ n = 24, seed = 1, className = "" }: { n?: number; seed?: number; className?: string }) {
  return (
    <div className={`flex h-full items-end gap-[3px] ${className}`}>
      {Array.from({ length: n }, (_, i) => {
        const h = 20 + ((Math.sin(i * 1.7 + seed) + 1) / 2) * 70 + ((i * seed) % 7);
        return <span key={i} className="flex-1 rounded-t-sm bg-current" style={{ height: `${h}%`, opacity: 0.5 + (i % 3) * 0.2 }} />;
      })}
    </div>
  );
}

function Candles({ n = 40 }: { n?: number }) {
  let p = 50;
  return (
    <div className="flex h-full items-center gap-[2px]">
      {Array.from({ length: n }, (_, i) => {
        const d = Math.sin(i * 0.9) * 6 + Math.cos(i * 0.37) * 4;
        const o = p;
        p = Math.min(85, Math.max(15, p + d));
        const up = p >= o;
        const top = 100 - Math.max(o, p);
        const h = Math.max(2, Math.abs(p - o));
        return (
          <span key={i} className="relative h-full flex-1">
            <span className={`absolute left-1/2 w-px -translate-x-1/2 ${up ? "bg-up" : "bg-down"}`} style={{ top: `${top - 4}%`, height: `${h + 8}%` }} />
            <span className={`absolute inset-x-0 rounded-[1px] ${up ? "bg-up" : "bg-down"}`} style={{ top: `${top}%`, height: `${h}%` }} />
          </span>
        );
      })}
    </div>
  );
}

export function TerminalMockup({ className = "" }: { className?: string }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-white/10 bg-bg shadow-[0_0_80px_-20px_rgba(232,217,188,0.18)] ${className}`}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-down/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-warn/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-up/70" />
        <span className="mx-auto h-4 w-1/3 rounded border border-primary/50 bg-panel" />
      </div>
      <div className="grid grid-cols-[1fr_32%] gap-px bg-line">
        <div className="bg-bg p-3">
          <div className="h-40 md:h-56">
            <Candles />
          </div>
          <div className="mt-2 h-10 text-primary/60">
            <Bars n={40} seed={3} />
          </div>
        </div>
        <div className="space-y-2 bg-bg p-3">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="h-5 w-5 rounded-full" style={{ background: `hsl(${i * 47} 70% 55%)` }} />
              <span className="h-2 flex-1 rounded bg-panel-3" />
              <span className={`h-2 w-8 rounded ${i % 3 ? "bg-up/60" : "bg-down/60"}`} />
            </div>
          ))}
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            <span className="h-7 rounded bg-up/80" />
            <span className="h-7 rounded bg-panel-3" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function DualMonitorMockup() {
  const Screen = ({ variant }: { variant: 0 | 1 }) => (
    <div className="flex flex-col items-center">
      <div className="w-full overflow-hidden rounded-md border-4 border-line bg-bg p-2 shadow-2xl">
        {variant === 0 ? (
          <div className="grid h-36 grid-cols-2 gap-1.5 md:h-48">
            <div className="text-link/80"><Bars n={18} seed={2} /></div>
            <div className="rounded bg-gradient-to-t from-link/50 to-link/5 [clip-path:polygon(0_100%,0_60%,15%_40%,30%_55%,45%_20%,60%_35%,75%_10%,90%_30%,100%_25%,100%_100%)]" />
            <div className="text-soft/50"><Bars n={30} seed={5} /></div>
            <div className="grid grid-cols-6 gap-0.5">
              {Array.from({ length: 36 }, (_, i) => (
                <span key={i} className={i % 4 === 0 ? "bg-down/60" : i % 3 === 0 ? "bg-up/50" : "bg-mcap/40"} />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex h-36 items-end gap-[2px] md:h-48">
            {Array.from({ length: 48 }, (_, i) => {
              const h = 40 + Math.sin(i * 0.5) * 20 + (i % 5) * 4;
              return (
                <span key={i} className="flex flex-1 flex-col justify-end" style={{ height: `${h}%` }}>
                  <span className="bg-mcap/80" style={{ height: "30%" }} />
                  <span className="bg-[#2b7a8c]" style={{ height: "35%" }} />
                  <span className="bg-[#2a3a9a]" style={{ height: "20%" }} />
                  <span className="bg-[#e8c9a6]" style={{ height: "15%" }} />
                </span>
              );
            })}
          </div>
        )}
      </div>
      <div className="h-6 w-6 bg-panel-2" />
      <div className="h-1.5 w-28 rounded bg-panel-2" />
    </div>
  );
  return (
    <div className="mx-auto grid max-w-4xl grid-cols-2 gap-3 md:gap-6">
      <Screen variant={0} />
      <Screen variant={1} />
    </div>
  );
}

export function GlobeGlow() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[60%] overflow-hidden">
      <div className="absolute top-[35%] left-1/2 aspect-square w-[160%] -translate-x-1/2 rounded-full border border-white/10 bg-[radial-gradient(circle_at_50%_0%,rgba(61,129,255,0.35),rgba(0,0,0,0)_40%)] shadow-[0_-30px_120px_-20px_rgba(61,129,255,0.45)]">
        <div className="bg-grid absolute inset-0 rounded-full opacity-60 [mask-image:radial-gradient(circle_at_50%_0%,black,transparent_45%)]" />
      </div>
    </div>
  );
}
