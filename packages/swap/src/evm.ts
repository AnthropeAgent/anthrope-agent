/**
 * EVM (Base, BNB Chain): KyberSwap Aggregator API (gratis, tanpa key) + pemeriksaan & simulasi lewat RPC.
 *
 * - Router wajib alamat resmi KyberSwap (MetaAggregationRouterV2); alamat lain = ditolak.
 * - Token ERC-20: bila allowance kurang, yang dikembalikan transaksi approve SEJUMLAH amountIn (bukan unlimited).
 * - Simulasi: eth_call + eth_estimateGas dari wallet user. Router KyberSwap me-revert bila hasil < minAmountOut.
 */
import { NATIVE_EVM, SWAP_CHAINS, type EvmSwapChain } from "./chains";
import { cleanLabel, getJson, rpc, SwapError, uintStr, type Fetch } from "./util";

export const KYBER_ROUTER = "0x6131b5fae19ea4f9d964eac0408e4408b66337b5";
const KYBER = () => (process.env.KYBER_API_URL || "https://aggregator-api.kyberswap.com").replace(/\/$/, "");
const CLIENT_ID = () => process.env.KYBER_CLIENT_ID || "onchain-terminal";

const pad = (hex: string) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const hexU = (v: string | bigint) => "0x" + BigInt(v).toString(16);

export const erc20 = {
  allowance: (owner: string, spender: string) => "0xdd62ed3e" + pad(owner) + pad(spender),
  approve: (spender: string, amount: string) => "0x095ea7b3" + pad(spender) + pad(BigInt(amount).toString(16)),
  balanceOf: (owner: string) => "0x70a08231" + pad(owner),
  decimals: "0x313ce567",
};

type KyberRouteSummary = { amountIn: string; amountOut: string; amountInUsd?: string; amountOutUsd?: string; route?: { exchange?: string }[][] };

export async function kyberQuote(f: Fetch, c: EvmSwapChain, input: string, output: string, amountIn: string, slippageBps: number) {
  const qs = new URLSearchParams({ tokenIn: input, tokenOut: output, amountIn, gasInclude: "true" });
  const r = await getJson<{ code: number; message?: string; data?: { routeSummary?: KyberRouteSummary; routerAddress?: string } }>(
    f,
    `${KYBER()}/${c.kyber}/api/v1/routes?${qs}`,
    { headers: { "x-client-id": CLIENT_ID() } },
  ).catch((e: SwapError) => {
    const d = e.detail as { message?: string } | undefined;
    if (e.code === "UPSTREAM_ERROR") throw new SwapError(422, "NO_ROUTE", `Tidak ada rute swap: ${cleanLabel(d?.message)}`);
    throw e;
  });
  const s = r.data?.routeSummary;
  if (r.code !== 0 || !s) throw new SwapError(422, "NO_ROUTE", `Tidak ada rute swap: ${cleanLabel(r.message)}`);
  if (String(r.data?.routerAddress ?? "").toLowerCase() !== KYBER_ROUTER) throw new SwapError(502, "TX_REJECTED", "Router aggregator tidak dikenal");
  const amountOut = uintStr(s.amountOut, "amountOut");
  const inUsd = Number(s.amountInUsd);
  const outUsd = Number(s.amountOutUsd);
  return {
    raw: s,
    amountOut,
    minAmountOut: ((BigInt(amountOut) * BigInt(10_000 - slippageBps)) / 10_000n).toString(),
    priceImpactPct: inUsd > 0 && outUsd > 0 ? Math.max(0, (1 - outUsd / inUsd) * 100) : 0,
    route: [...new Set((s.route ?? []).flat().map((h) => cleanLabel(h.exchange)))],
  };
}

export interface EvmTx {
  chainId: number;
  from: string;
  to: string;
  data: string;
  value: string; // hex
  gas?: string; // hex
}

export async function kyberBuild(f: Fetch, c: EvmSwapChain, summary: unknown, wallet: string, slippageBps: number, input: string, amountIn: string) {
  const r = await getJson<{ code: number; message?: string; data?: { amountOut?: string; data?: string; routerAddress?: string; transactionValue?: string } }>(
    f,
    `${KYBER()}/${c.kyber}/api/v1/route/build`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-client-id": CLIENT_ID() },
      body: JSON.stringify({
        routeSummary: summary,
        sender: wallet,
        recipient: wallet,
        slippageTolerance: slippageBps,
        deadline: Math.floor(Date.now() / 1000) + 20 * 60,
        source: CLIENT_ID(),
      }),
    },
  );
  const d = r.data;
  if (r.code !== 0 || !d || typeof d.data !== "string" || !/^0x[0-9a-fA-F]+$/.test(d.data)) throw new SwapError(502, "AGGREGATOR_BAD_RESPONSE", `Aggregator gagal membangun transaksi: ${cleanLabel(r.message)}`);
  if (String(d.routerAddress).toLowerCase() !== KYBER_ROUTER) throw new SwapError(502, "TX_REJECTED", "Router aggregator tidak dikenal");
  const value = BigInt(uintStr(d.transactionValue ?? "0", "transactionValue"));
  const expected = input === NATIVE_EVM ? BigInt(amountIn) : 0n;
  if (value !== expected) throw new SwapError(502, "TX_REJECTED", "Nilai transaksi dari aggregator tidak sesuai jumlah swap");
  const tx: EvmTx = { chainId: c.chainId, from: wallet, to: KYBER_ROUTER, data: d.data, value: hexU(value) };
  return { tx, amountOut: uintStr(d.amountOut, "amountOut") };
}

const callObj = (tx: EvmTx) => ({ from: tx.from, to: tx.to, data: tx.data, value: tx.value });

export async function simulateEvm(f: Fetch, c: EvmSwapChain, tx: EvmTx) {
  try {
    await rpc<string>(f, c.rpc(), "eth_call", [callObj(tx), "latest"]);
    const gas = await rpc<string>(f, c.rpc(), "eth_estimateGas", [callObj(tx)]);
    const withBuffer = (BigInt(gas) * 12n) / 10n; // +20%
    return { ok: true, err: null as string | null, gas: hexU(withBuffer) };
  } catch (e) {
    if (e instanceof SwapError && e.code === "RPC_ERROR") return { ok: false, err: e.message.slice(0, 200), gas: null };
    throw e;
  }
}

export async function evmAllowance(f: Fetch, c: EvmSwapChain, token: string, owner: string): Promise<bigint> {
  const r = await rpc<string>(f, c.rpc(), "eth_call", [{ to: token, data: erc20.allowance(owner, KYBER_ROUTER) }, "latest"]);
  return BigInt(r && r !== "0x" ? r : "0x0");
}

export function approveTx(c: EvmSwapChain, token: string, owner: string, amount: string): EvmTx {
  return { chainId: c.chainId, from: owner, to: token, data: erc20.approve(KYBER_ROUTER, amount), value: "0x0" };
}

export async function evmDecimals(f: Fetch, c: EvmSwapChain, token: string): Promise<number> {
  if (token === NATIVE_EVM) return 18;
  const r = await rpc<string>(f, c.rpc(), "eth_call", [{ to: token, data: erc20.decimals }, "latest"]).catch(() => "0x");
  const d = r && r !== "0x" ? Number(BigInt(r)) : NaN;
  if (!Number.isInteger(d) || d < 0 || d > 36) throw new SwapError(422, "TOKEN_UNKNOWN", "Token tidak ditemukan di chain ini");
  return d;
}

export async function evmBalance(f: Fetch, c: EvmSwapChain, owner: string, token: string): Promise<string> {
  if (token === NATIVE_EVM) return BigInt(await rpc<string>(f, c.rpc(), "eth_getBalance", [owner, "latest"])).toString();
  const r = await rpc<string>(f, c.rpc(), "eth_call", [{ to: token, data: erc20.balanceOf(owner) }, "latest"]);
  return BigInt(r && r !== "0x" ? r : "0x0").toString();
}

export async function evmStatus(f: Fetch, c: EvmSwapChain, hash: string): Promise<"pending" | "confirmed" | "failed"> {
  const r = await rpc<{ status?: string } | null>(f, c.rpc(), "eth_getTransactionReceipt", [hash]);
  if (!r) return "pending";
  return r.status === "0x1" ? "confirmed" : "failed";
}

export const isEvmChain = (id: string): boolean => (SWAP_CHAINS as Record<string, { kind: string }>)[id]?.kind === "evm";
