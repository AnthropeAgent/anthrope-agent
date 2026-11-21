/**
 * Data pihak ketiga tidak tepercaya (ARCHITECTURE §7.8): nama/simbol token bisa berisi HTML,
 * karakter kontrol, atau karakter bidi (RTL override) untuk menipu tampilan.
 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;
const ZERO_WIDTH = /[​-‍⁠﻿]/g;

export function cleanText(input: unknown, maxLen: number): string {
  if (typeof input !== "string") return "";
  return input.replace(CONTROL, "").replace(BIDI, "").replace(ZERO_WIDTH, "").replace(/[<>]/g, "").trim().slice(0, maxLen);
}

/** Hanya URL http(s) yang diterima; selain itu dibuang. */
export function cleanUrl(input: unknown): string | undefined {
  if (typeof input !== "string" || input.length > 500) return undefined;
  try {
    const u = new URL(input);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Angka dari string/number provider; selain angka hingga → null. */
export function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}
