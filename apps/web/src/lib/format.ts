const SUB = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
const toSub = (n: number) => String(n).split("").map((d) => SUB[Number(d)]).join("");

/** Harga dengan notasi subscript nol: 0.00002038 -> 0.0₄2038 */
export function fmtPrice(p: number, prefix = "$"): string {
  if (!Number.isFinite(p)) return "_";
  if (p >= 1000) return prefix + p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (p >= 1) return prefix + p.toFixed(p >= 100 ? 2 : 4).replace(/\.?0+$/, (m) => (m.startsWith(".") ? "" : m));
  if (p >= 0.001) return prefix + p.toPrecision(4);
  const s = p.toFixed(20).split(".")[1] ?? "";
  const zeros = s.match(/^0*/)?.[0].length ?? 0;
  const digits = s.slice(zeros, zeros + 4);
  return `${prefix}0.0${toSub(zeros)}${digits}`;
}

/** $24.75M, $1.43B, $226.95K */
export function fmtUsd(n: number, prefix = "$"): string {
  if (!Number.isFinite(n)) return "_";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [v, u] of units) if (a >= v) return `${sign}${prefix}${(a / v).toFixed(2).replace(/\.00$/, "")}${u}`;
  return `${sign}${prefix}${a.toFixed(2)}`;
}

export const fmtNum = (n: number) => fmtUsd(n, "");

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "_";
  const abs = Math.abs(n);
  const v = abs >= 100 ? abs.toFixed(0) : abs.toFixed(2).replace(/\.?0+$/, "");
  return `${n >= 0 ? "+" : "-"}${v}%`;
}

export const pctClass = (n: number | null | undefined) =>
  n == null ? "text-muted" : n >= 0 ? "text-up" : "text-down";

/** Umur dari menit: 45m, 14h, 3d, 1mo, 2y */
export function fmtAge(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  const h = minutes / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  const mo = d / 30;
  if (mo < 12) return `${Math.round(mo)}mo`;
  return `${Math.round(mo / 12)}y`;
}

export const shortAddr = (a: string, head = 4, tail = 4) =>
  a.length <= head + tail + 3 ? a : `${a.slice(0, head)}...${a.slice(-tail)}`;
