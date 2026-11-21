/**
 * Solana: Jupiter Swap API (quote → transaksi v0 belum ditandatangani) + pemeriksaan & simulasi lewat RPC.
 *
 * Batas minimum hasil (otherAmountThreshold) ditegakkan instruksi Jupiter on-chain: transaksi gagal bila
 * hasil < minimum. Jadi simulasi yang lolos = hasil ≥ minimum pada state saat itu.
 */
import { base58, base64 } from "@scure/base";
import { SWAP_CHAINS, WSOL_MINT } from "./chains";
import { cleanLabel, getJson, rpc, SwapError, uintStr, type Fetch } from "./util";

const JUP = () => (process.env.JUPITER_API_URL || "https://lite-api.jup.ag/swap/v1").replace(/\/$/, "");
const RPC = () => SWAP_CHAINS.solana.rpc();

/** Program yang boleh muncul di transaksi swap. Program lain = transaksi ditolak. */
export const SOLANA_ALLOWED_PROGRAMS = new Set([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", // Jupiter v6
  "ComputeBudget111111111111111111111111111111",
  "11111111111111111111111111111111", // System
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // Associated Token Account
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", // Memo
]);

export interface ParsedSolanaTx {
  feePayer: string;
  signers: number;
  programs: string[];
}

function compactU16(b: Uint8Array, off: number): [number, number] {
  let v = 0;
  for (let i = 0; i < 3; i++) {
    const x = b[off + i];
    if (x === undefined) throw new Error("tx terpotong");
    v |= (x & 0x7f) << (7 * i);
    if (!(x & 0x80)) return [v, off + i + 1];
  }
  throw new Error("compact-u16 tidak valid");
}

/** Baca fee payer, jumlah penandatangan, dan program yang dipanggil dari transaksi (legacy atau v0). */
export function parseSolanaTx(bytes: Uint8Array): ParsedSolanaTx {
  let off = 0;
  let n: number;
  [n, off] = compactU16(bytes, off);
  const sigs = n;
  off += 64 * sigs;
  if (bytes[off] & 0x80) {
    if ((bytes[off] & 0x7f) !== 0) throw new Error("versi transaksi tidak dikenal");
    off++;
  }
  const signers = bytes[off];
  off += 3;
  [n, off] = compactU16(bytes, off);
  const keys: string[] = [];
  for (let i = 0; i < n; i++, off += 32) keys.push(base58.encode(bytes.slice(off, off + 32)));
  off += 32; // recent blockhash
  [n, off] = compactU16(bytes, off);
  const programs: string[] = [];
  for (let i = 0; i < n; i++) {
    const p = bytes[off++];
    programs.push(keys[p] ?? "<lookup-table>"); // program ID wajib di kunci statis
    let len: number;
    [len, off] = compactU16(bytes, off);
    off += len;
    [len, off] = compactU16(bytes, off);
    off += len;
  }
  if (off > bytes.length || sigs !== signers || !keys.length) throw new Error("struktur transaksi tidak valid");
  return { feePayer: keys[0], signers, programs: [...new Set(programs)] };
}

/** Transaksi harus dibayar & ditandatangani HANYA oleh wallet user, dan hanya memanggil program yang dikenal. */
export function checkSolanaTx(txB64: string, wallet: string): ParsedSolanaTx {
  let p: ParsedSolanaTx;
  try {
    p = parseSolanaTx(base64.decode(txB64));
  } catch (e) {
    throw new SwapError(502, "TX_REJECTED", `Transaksi dari aggregator tidak bisa dibaca: ${(e as Error).message}`);
  }
  if (p.feePayer !== wallet || p.signers !== 1) throw new SwapError(502, "TX_REJECTED", "Transaksi dari aggregator tidak untuk wallet ini");
  const bad = p.programs.filter((x) => !SOLANA_ALLOWED_PROGRAMS.has(x));
  if (bad.length) throw new SwapError(502, "TX_REJECTED", `Transaksi memanggil program yang tidak diizinkan: ${bad.join(", ")}`);
  return p;
}

export interface JupQuote {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  routePlan: { swapInfo: { label?: string } }[];
  [k: string]: unknown;
}

export async function jupiterQuote(f: Fetch, input: string, output: string, amountIn: string, slippageBps: number) {
  const qs = new URLSearchParams({ inputMint: input, outputMint: output, amount: amountIn, slippageBps: String(slippageBps), restrictIntermediateTokens: "true" });
  let q: JupQuote & { error?: string; errorCode?: string };
  try {
    q = await getJson<JupQuote & { error?: string }>(f, `${JUP()}/quote?${qs}`);
  } catch (e) {
    const d = (e as SwapError).detail as { errorCode?: string; error?: string } | undefined;
    if (d?.errorCode) throw new SwapError(422, "NO_ROUTE", `Tidak ada rute swap: ${cleanLabel(d.errorCode)}`);
    throw e;
  }
  return {
    raw: q,
    amountOut: uintStr(q.outAmount, "outAmount"),
    minAmountOut: uintStr(q.otherAmountThreshold, "otherAmountThreshold"),
    priceImpactPct: Math.abs(Number(q.priceImpactPct) || 0) * 100,
    route: (q.routePlan ?? []).map((r) => cleanLabel(r.swapInfo?.label)),
  };
}

const PRIORITY: Record<string, { level: string; max: number }> = {
  auto: { level: "medium", max: 1_000_000 },
  low: { level: "medium", max: 200_000 },
  medium: { level: "high", max: 2_000_000 },
  high: { level: "veryHigh", max: 5_000_000 },
};

export async function jupiterBuild(f: Fetch, quote: JupQuote, wallet: string, priority: string) {
  const p = PRIORITY[priority] ?? PRIORITY.auto;
  const r = await getJson<{ swapTransaction?: string; lastValidBlockHeight?: number; simulationError?: unknown }>(f, `${JUP()}/swap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: wallet,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: p.max, priorityLevel: p.level } },
    }),
  });
  if (typeof r.swapTransaction !== "string") throw new SwapError(502, "AGGREGATOR_BAD_RESPONSE", "Aggregator tidak mengembalikan transaksi");
  return { tx: r.swapTransaction, lastValidBlockHeight: r.lastValidBlockHeight ?? null, maxPriorityLamports: p.max };
}

export async function simulateSolana(f: Fetch, txB64: string) {
  const r = await rpc<{ value: { err: unknown; logs: string[] | null; unitsConsumed?: number } }>(f, RPC(), "simulateTransaction", [
    txB64,
    { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" },
  ]);
  const logs = (r.value.logs ?? []).slice(-12).map((l) => l.slice(0, 200));
  return { ok: r.value.err == null, err: r.value.err == null ? null : JSON.stringify(r.value.err).slice(0, 200), logs, unitsConsumed: r.value.unitsConsumed ?? null };
}

export async function solanaDecimals(f: Fetch, mint: string): Promise<number> {
  if (mint === WSOL_MINT) return 9;
  const r = await rpc<{ value: { decimals: number } }>(f, RPC(), "getTokenSupply", [mint]);
  if (!Number.isInteger(r?.value?.decimals)) throw new SwapError(422, "TOKEN_UNKNOWN", "Token tidak ditemukan di Solana");
  return r.value.decimals;
}

/** Saldo raw: SOL (lamports) atau token SPL (jumlah semua token account untuk mint itu). */
export async function solanaBalance(f: Fetch, owner: string, mint: string): Promise<string> {
  if (mint === WSOL_MINT) {
    const r = await rpc<{ value: number }>(f, RPC(), "getBalance", [owner, { commitment: "confirmed" }]);
    return String(r.value);
  }
  const r = await rpc<{ value: { account: { data: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }[] }>(
    f,
    RPC(),
    "getTokenAccountsByOwner",
    [owner, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }],
  );
  return r.value.reduce((s, a) => s + BigInt(a.account.data.parsed?.info?.tokenAmount?.amount ?? "0"), 0n).toString();
}

export type TxStatus = "pending" | "confirmed" | "failed";
export async function solanaStatuses(f: Fetch, sigs: string[]): Promise<TxStatus[]> {
  const r = await rpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>(f, RPC(), "getSignatureStatuses", [
    sigs,
    { searchTransactionHistory: true },
  ]);
  return r.value.map((s) => (!s ? "pending" : s.err ? "failed" : s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized" ? "confirmed" : "pending"));
}
