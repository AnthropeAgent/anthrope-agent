"use client";

/** Klien /api/v1/swap (langkah 6). Semua transaksi ditandatangani di wallet user, bukan di server. */
import { useSyncExternalStore } from "react";
import type { EvmTxRequest, WalletOption } from "./auth/wallets";

export const SWAP_CHAINS: Record<string, { kind: "solana" | "evm"; native: string; buyPresets: string[] }> = {
  solana: { kind: "solana", native: "SOL", buyPresets: ["0.05", "0.1", "0.5", "1"] },
  base: { kind: "evm", native: "ETH", buyPresets: ["0.005", "0.01", "0.05", "0.1"] },
  bsc: { kind: "evm", native: "BNB", buyPresets: ["0.01", "0.05", "0.1", "0.5"] },
};

export interface SwapQuote {
  quoteId: string;
  chain: string;
  side: "buy" | "sell";
  aggregator: string;
  nativeSymbol: string;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  amountInFormatted: string;
  amountOutFormatted: string;
  minAmountOutFormatted: string;
  slippageBps: number;
  priceImpactPct: number;
  route: string[];
  feeBps: number;
  expiresAt: string;
}

export type BuildResponse =
  | { needsApproval: true; chain: string; approvalTx: EvmTxRequest; message: string }
  | {
      needsApproval: false;
      orderId: string | null;
      chain: string;
      kind: "solana" | "evm";
      unsignedTx: string | EvmTxRequest;
      simulation: { ok: boolean; expectedOutFormatted: string; minAmountOutFormatted: string; logs: string[] };
    };

export interface SwapOrder {
  id: string;
  chain: string;
  side: "buy" | "sell" | null;
  status: "built" | "submitted" | "confirmed" | "failed";
  txSignature: string | null;
  explorerUrl: string | null;
}

export interface Balances {
  native: { symbol: string; raw: string; decimals: number; formatted: string };
  token: { address: string; raw: string; decimals: number; formatted: string } | null;
}

export class SwapApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new SwapApiError(res.status, e?.error?.code ?? "HTTP_ERROR", e?.error?.message ?? `HTTP ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const swapApi = {
  quote: (b: { chain: string; side: "buy" | "sell"; token: string; amount: string; slippageBps: number }) => call<SwapQuote>("POST", "/swap/quote", b),
  build: (quoteId: string, wallet: string) => call<BuildResponse>("POST", "/swap/build", { quoteId, wallet }),
  track: (orderId: string, txSignature: string) => call<void>("POST", "/swap/track", { orderId, txSignature }),
  order: (id: string) => call<SwapOrder>("GET", `/swap/orders/${id}`),
  balance: (chain: string, wallet: string, token: string) => call<Balances>("GET", `/swap/balance?${new URLSearchParams({ chain, wallet, token })}`),
};

// ------------------------------------------------------------------ wallet terhubung (per jenis chain, dipakai ulang antar token)
type Conn = { wallet: WalletOption; address: string } | null;
const conns: Record<"solana" | "evm", Conn> = { solana: null, evm: null };
const listeners = new Set<() => void>();
let snapshot = { ...conns };

export function setConnection(kind: "solana" | "evm", c: Conn) {
  conns[kind] = c;
  snapshot = { ...conns };
  listeners.forEach((l) => l());
}

export function useConnections() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
    () => snapshot,
  );
}

/** Pesan error yang ramah untuk user. */
export function friendlySwapError(e: unknown): string {
  if (e instanceof SwapApiError) {
    switch (e.code) {
      case "INSUFFICIENT_BALANCE":
      case "SIMULATION_FAILED":
      case "NO_ROUTE":
        return e.message;
      case "QUOTE_EXPIRED":
      case "QUOTE_MOVED":
        return "Harga sudah berubah. Quote diperbarui, coba lagi.";
      case "RATE_LIMITED":
        return "Terlalu banyak permintaan. Tunggu sebentar.";
      case "SWAP_DISABLED":
        return "Swap sedang dinonaktifkan.";
      default:
        return e.status >= 500 ? "Aggregator atau RPC sedang bermasalah. Coba lagi sebentar." : e.message;
    }
  }
  const code = (e as { code?: number })?.code;
  const msg = (e as Error)?.message ?? "";
  if (code === 4001 || /reject|denied|cancel/i.test(msg)) return "Dibatalkan di wallet.";
  return msg || "Terjadi kesalahan.";
}
