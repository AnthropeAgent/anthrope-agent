/**
 * Saldo wallet lewat RPC (langkah 8), dipanggil hanya dari worker.
 * Solana: SOL + semua akun SPL/Token-2022. EVM: native + balanceOf untuk token yang dipantau platform
 * (RPC biasa tidak bisa mendaftar semua ERC-20 milik wallet tanpa indexer).
 */
import { cleanText } from "./sanitize";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

async function rpc<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`rpc HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function call<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const j = await rpc<{ result?: T; error?: { message?: string } }>(url, { jsonrpc: "2.0", id: 1, method, params });
  if (j.error) throw new Error(`${method}: ${cleanText(j.error.message, 120)}`);
  return j.result as T;
}

export interface RawBalance {
  token: string;
  amount: number;
}

export async function solanaBalances(url: string, owner: string): Promise<{ native: number; tokens: RawBalance[] }> {
  const lamports = await call<{ value: number }>(url, "getBalance", [owner]);
  type Acc = { account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null } } } } } };
  const tokens: RawBalance[] = [];
  for (const programId of [TOKEN_PROGRAM, TOKEN_2022]) {
    const r = await call<{ value: Acc[] }>(url, "getTokenAccountsByOwner", [owner, { programId }, { encoding: "jsonParsed" }]);
    for (const a of r.value) {
      const info = a.account.data.parsed?.info;
      const amt = info?.tokenAmount?.uiAmount ?? 0;
      if (amt > 0 && typeof info.mint === "string") tokens.push({ token: info.mint, amount: amt });
    }
  }
  return { native: lamports.value / 1e9, tokens };
}

const pad = (a: string) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

/** Multicall3: alamat sama di Base & BNB Chain (dan hampir semua chain EVM). */
export const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const word = (n: number | bigint) => BigInt(n).toString(16).padStart(64, "0");

/** ABI encode aggregate3((address target, bool allowFailure, bytes callData)[]). */
export function encodeAggregate3(calls: { target: string; data: string }[]): string {
  const enc = calls.map((c) => {
    const d = c.data.replace(/^0x/, "");
    const len = d.length / 2;
    return pad(c.target) + word(1) + word(0x60) + word(len) + d.padEnd(Math.ceil(len / 32) * 64, "0");
  });
  let off = calls.length * 32;
  const offs = enc.map((e) => {
    const o = word(off);
    off += e.length / 2;
    return o;
  });
  return "0x82ad56cb" + word(0x20) + word(calls.length) + offs.join("") + enc.join("");
}

/** Decode Result[] (bool success, bytes returnData). */
export function decodeAggregate3(hex: string): { ok: boolean; data: string }[] {
  const h = hex.replace(/^0x/, "");
  const w = (byte: number) => BigInt("0x" + (h.slice(byte * 2, byte * 2 + 64) || "0"));
  const base = Number(w(0));
  const n = Number(w(base));
  const start = base + 32;
  const out: { ok: boolean; data: string }[] = [];
  for (let i = 0; i < n; i++) {
    const t = start + Number(w(start + 32 * i));
    const bo = t + Number(w(t + 32));
    const len = Number(w(bo));
    out.push({ ok: w(t) === BigInt(1), data: "0x" + h.slice((bo + 32) * 2, (bo + 32 + len) * 2) });
  }
  return out;
}

/** Native + saldo ERC-20 untuk daftar token (Multicall3: balanceOf + decimals, 100 token per eth_call). */
export async function evmBalances(url: string, owner: string, tokens: string[]): Promise<{ native: number; tokens: RawBalance[] }> {
  const native = await call<string>(url, "eth_getBalance", [owner, "latest"]);
  const out: RawBalance[] = [];
  for (let i = 0; i < tokens.length; i += 100) {
    const chunk = tokens.slice(i, i + 100);
    const calls = chunk.flatMap((t) => [
      { target: t, data: "0x70a08231" + pad(owner) },
      { target: t, data: "0x313ce567" },
    ]);
    const res = await call<string>(url, "eth_call", [{ to: MULTICALL3, data: encodeAggregate3(calls) }, "latest"]).then(decodeAggregate3);
    chunk.forEach((t, j) => {
      const bal = res[j * 2];
      const dec = res[j * 2 + 1];
      if (!bal?.ok || !dec?.ok || bal.data.length < 66 || dec.data.length < 66) return;
      const raw = BigInt(bal.data.slice(0, 66));
      const d = Number(BigInt(dec.data.slice(0, 66)));
      if (raw === BigInt(0) || d > 36) return;
      out.push({ token: t.toLowerCase(), amount: Number(raw) / 10 ** d });
    });
  }
  return { native: Number(BigInt(native)) / 1e18, tokens: out };
}
