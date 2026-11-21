/**
 * Swap non-custodial (ARCHITECTURE §4.12, langkah 6).
 *
 * quote()  → harga dari aggregator untuk Buy (native → token) atau Sell (token → native).
 * build()  → transaksi BELUM ditandatangani untuk wallet user, diperiksa, lalu disimulasikan.
 *            Simulasi gagal = transaksi tidak dikembalikan (SwapError 422).
 * Server tidak pernah memegang private key dan tidak pernah mengirim transaksi.
 */
import { isAddressFor, normAddr, SWAP_CHAINS, type SwapChainId } from "./chains";
import { approveTx, evmAllowance, evmBalance, evmDecimals, evmStatus, kyberBuild, kyberQuote, simulateEvm, type EvmTx } from "./evm";
import { checkSolanaTx, jupiterBuild, jupiterQuote, simulateSolana, solanaBalance, solanaDecimals, solanaStatuses, type JupQuote, type TxStatus } from "./solana";
import { formatUnits, parseUnits, SwapError, type Fetch } from "./util";

export * from "./chains";
export { checkSolanaTx, parseSolanaTx, SOLANA_ALLOWED_PROGRAMS, type TxStatus } from "./solana";
export { erc20, KYBER_ROUTER, type EvmTx } from "./evm";
export { formatUnits, parseUnits, SwapError, type Fetch } from "./util";

export const QUOTE_TTL_SEC = 30;
export const MAX_SLIPPAGE_BPS = 5000;
export const DEFAULT_SLIPPAGE_BPS = 100;

export interface QuoteRequest {
  chain: SwapChainId;
  side: "buy" | "sell";
  token: string;
  /** Jumlah yang dibayar dalam satuan biasa ("0.5"): native untuk buy, token untuk sell. */
  amount: string;
  slippageBps: number;
}

export interface SwapQuote {
  chain: SwapChainId;
  side: "buy" | "sell";
  aggregator: "jupiter" | "kyberswap";
  inputToken: string;
  outputToken: string;
  inputDecimals: number;
  outputDecimals: number;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  slippageBps: number;
  priceImpactPct: number;
  route: string[];
  /** Respons asli aggregator; dipakai saat build, tidak dikirim ke klien. */
  raw: unknown;
}

export type BuildResult =
  | { kind: "solana"; tx: string; simulation: Simulation; lastValidBlockHeight: number | null }
  | { kind: "evm"; tx: EvmTx; simulation: Simulation }
  | { kind: "evm-approval"; approval: EvmTx };

export interface Simulation {
  ok: boolean;
  expectedOut: string;
  minAmountOut: string;
  logs: string[];
}

// desimal token tidak berubah: cache per proses
const decCache = new Map<string, number>();
export async function tokenDecimals(f: Fetch, chain: SwapChainId, token: string): Promise<number> {
  const k = `${chain}:${token}`;
  const hit = decCache.get(k);
  if (hit !== undefined) return hit;
  const c = SWAP_CHAINS[chain];
  const d = c.kind === "solana" ? await solanaDecimals(f, token) : await evmDecimals(f, c, token);
  if (decCache.size > 5000) decCache.clear();
  decCache.set(k, d);
  return d;
}

export async function quote(f: Fetch, r: QuoteRequest): Promise<SwapQuote> {
  const c = SWAP_CHAINS[r.chain];
  if (!isAddressFor(r.chain, r.token)) throw new SwapError(400, "INVALID_TOKEN", "Alamat token tidak valid untuk chain ini");
  const token = normAddr(r.chain, r.token);
  if (token === c.native.address) throw new SwapError(400, "INVALID_TOKEN", `Token sama dengan ${c.native.symbol}`);
  const slippageBps = Math.min(MAX_SLIPPAGE_BPS, Math.max(1, Math.round(r.slippageBps)));
  const [input, output] = r.side === "buy" ? [c.native.address, token] : [token, c.native.address];
  const [inputDecimals, outputDecimals] = await Promise.all([tokenDecimals(f, r.chain, input), tokenDecimals(f, r.chain, output)]);
  const amountIn = parseUnits(r.amount, inputDecimals);
  if (!amountIn) throw new SwapError(400, "INVALID_AMOUNT", "Jumlah tidak valid");

  const q = c.kind === "solana" ? await jupiterQuote(f, input, output, amountIn, slippageBps) : await kyberQuote(f, c, input, output, amountIn, slippageBps);
  return {
    chain: r.chain,
    side: r.side,
    aggregator: c.kind === "solana" ? "jupiter" : "kyberswap",
    inputToken: input,
    outputToken: output,
    inputDecimals,
    outputDecimals,
    amountIn,
    amountOut: q.amountOut,
    minAmountOut: q.minAmountOut,
    slippageBps,
    priceImpactPct: Math.round(q.priceImpactPct * 100) / 100,
    route: q.route,
    raw: q.raw,
  };
}

export async function balance(f: Fetch, chain: SwapChainId, wallet: string, token: string): Promise<string> {
  const c = SWAP_CHAINS[chain];
  return c.kind === "solana" ? solanaBalance(f, wallet, token) : evmBalance(f, c, wallet, token);
}

export async function build(f: Fetch, q: SwapQuote, walletIn: string, priority = "auto"): Promise<BuildResult> {
  const c = SWAP_CHAINS[q.chain];
  if (!isAddressFor(q.chain, walletIn)) throw new SwapError(400, "INVALID_WALLET", "Alamat wallet tidak valid untuk chain ini");
  const wallet = normAddr(q.chain, walletIn);

  const bal = BigInt(await balance(f, q.chain, wallet, q.inputToken));
  if (bal < BigInt(q.amountIn))
    throw new SwapError(422, "INSUFFICIENT_BALANCE", `Saldo tidak cukup: ada ${formatUnits(bal, q.inputDecimals)}, perlu ${formatUnits(q.amountIn, q.inputDecimals)}`);

  if (c.kind === "solana") {
    const b = await jupiterBuild(f, q.raw as JupQuote, wallet, priority);
    checkSolanaTx(b.tx, wallet);
    const sim = await simulateSolana(f, b.tx);
    if (!sim.ok) throw new SwapError(422, "SIMULATION_FAILED", `Simulasi gagal, transaksi tidak dikirim: ${sim.err}`, { logs: sim.logs });
    return {
      kind: "solana",
      tx: b.tx,
      lastValidBlockHeight: b.lastValidBlockHeight,
      simulation: { ok: true, expectedOut: q.amountOut, minAmountOut: q.minAmountOut, logs: sim.logs },
    };
  }

  if (q.inputToken !== c.native.address && (await evmAllowance(f, c, q.inputToken, wallet)) < BigInt(q.amountIn)) {
    return { kind: "evm-approval", approval: approveTx(c, q.inputToken, wallet, q.amountIn) };
  }
  const b = await kyberBuild(f, c, q.raw, wallet, q.slippageBps, q.inputToken, q.amountIn);
  if (BigInt(b.amountOut) < BigInt(q.minAmountOut)) throw new SwapError(409, "QUOTE_MOVED", "Harga berubah melewati slippage; minta quote baru");
  const sim = await simulateEvm(f, c, b.tx);
  if (!sim.ok) throw new SwapError(422, "SIMULATION_FAILED", `Simulasi gagal, transaksi tidak dikirim: ${sim.err}`);
  return { kind: "evm", tx: { ...b.tx, gas: sim.gas ?? undefined }, simulation: { ok: true, expectedOut: b.amountOut, minAmountOut: q.minAmountOut, logs: [] } };
}

/** Status transaksi yang sudah dikirim user (dipakai worker). */
export async function txStatuses(f: Fetch, chain: SwapChainId, ids: string[]): Promise<TxStatus[]> {
  const c = SWAP_CHAINS[chain];
  if (!ids.length) return [];
  if (c.kind === "solana") return solanaStatuses(f, ids);
  return Promise.all(ids.map((h) => evmStatus(f, c, h)));
}
