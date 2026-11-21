// Probe manual (tidak dijalankan di npm test): build transaksi untuk wallet kosong, TIDAK ditandatangani/dikirim.
import { randomBytes } from "node:crypto";
import { base58 } from "@scure/base";
import { checkSolanaTx, quote, SwapError } from "../src/index";
import { jupiterBuild, simulateSolana, type JupQuote } from "../src/solana";
import { kyberBuild, simulateEvm } from "../src/evm";
import { SWAP_CHAINS } from "../src/chains";

const f = fetch;
const emptySol = base58.encode(randomBytes(32));
const q = await quote(f, { chain: "solana", side: "buy", token: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", amount: "0.01", slippageBps: 100 });
console.log("SOL quote", q.amountIn, "->", q.amountOut, "min", q.minAmountOut, "impact%", q.priceImpactPct, q.route);
const b = await jupiterBuild(f, q.raw as JupQuote, emptySol, "auto");
console.log("check", checkSolanaTx(b.tx, emptySol));
console.log("sim (wallet kosong, harus gagal)", (await simulateSolana(f, b.tx)).err);
try { checkSolanaTx(b.tx, base58.encode(randomBytes(32))); } catch (e) { console.log("wallet lain ditolak:", (e as SwapError).code); }

const emptyEvm = "0x" + randomBytes(20).toString("hex");
const eq = await quote(f, { chain: "base", side: "buy", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "0.001", slippageBps: 100 });
console.log("BASE quote", eq.amountIn, "->", eq.amountOut, "min", eq.minAmountOut, "impact%", eq.priceImpactPct, eq.route);
const eb = await kyberBuild(f, SWAP_CHAINS.base, eq.raw, emptyEvm, 100, eq.inputToken, eq.amountIn);
console.log("evm tx to", eb.tx.to, "value", eb.tx.value, "out", eb.amountOut);
console.log("sim (wallet kosong, harus gagal)", (await simulateEvm(f, SWAP_CHAINS.base, eb.tx)).err?.slice(0, 120));
const sq = await quote(f, { chain: "bsc", side: "sell", token: "0x55d398326f99059fF775485246999027B3197955", amount: "1", slippageBps: 50 });
console.log("BSC sell USDT quote", sq.amountIn, "->", sq.amountOut, sq.inputDecimals, sq.outputDecimals, sq.route);
