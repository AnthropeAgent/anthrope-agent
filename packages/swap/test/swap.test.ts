import assert from "node:assert/strict";
import { test } from "node:test";
import { base58, base64 } from "@scure/base";
import { build, checkSolanaTx, erc20, formatUnits, KYBER_ROUTER, NATIVE_EVM, parseSolanaTx, parseUnits, quote, SwapError, WSOL_MINT, type Fetch } from "../src/index";

const key = (n: number) => new Uint8Array(32).fill(n);
const PAYER = key(7);
const JUP = base58.decode("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

/** Transaksi legacy minimal: 1 penandatangan, instruksi ke program yang diberikan. */
function legacyTx(payer: Uint8Array, programs: Uint8Array[], signers = 1): string {
  const keys = [payer, ...programs];
  const bytes = [signers, ...new Array(64 * signers).fill(0), signers, 0, programs.length, keys.length, ...keys.flatMap((k) => [...k]), ...new Array(32).fill(1), programs.length];
  programs.forEach((_, i) => bytes.push(i + 1, 1, 0, 2, 9, 9));
  return base64.encode(new Uint8Array(bytes));
}

test("parseUnits / formatUnits", () => {
  assert.equal(parseUnits("1.5", 9), "1500000000");
  assert.equal(parseUnits("0.0000000019", 9), "1"); // dipotong ke presisi token
  assert.equal(parseUnits("0", 9), null);
  assert.equal(parseUnits("1e5", 9), null);
  assert.equal(parseUnits("-1", 9), null);
  assert.equal(formatUnits("1500000000", 9), "1.5");
  assert.equal(formatUnits("1", 6), "0.000001");
  assert.equal(formatUnits("1000000", 6), "1");
});

test("transaksi Solana: fee payer = wallet, hanya program yang diizinkan", () => {
  const ok = legacyTx(PAYER, [JUP]);
  assert.deepEqual(parseSolanaTx(base64.decode(ok)).programs, ["JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"]);
  assert.equal(checkSolanaTx(ok, base58.encode(PAYER)).feePayer, base58.encode(PAYER));
  const code = (fn: () => unknown) => {
    try {
      fn();
      return "ok";
    } catch (e) {
      return (e as SwapError).code;
    }
  };
  assert.equal(code(() => checkSolanaTx(ok, base58.encode(key(8)))), "TX_REJECTED"); // wallet lain
  assert.equal(code(() => checkSolanaTx(legacyTx(PAYER, [JUP, key(66)]), base58.encode(PAYER))), "TX_REJECTED"); // program asing
  assert.equal(code(() => checkSolanaTx(legacyTx(PAYER, [JUP], 2), base58.encode(PAYER))), "TX_REJECTED"); // butuh 2 penanda tangan
  assert.equal(code(() => checkSolanaTx("AAAA", base58.encode(PAYER))), "TX_REJECTED");
});

test("encoding ERC-20", () => {
  assert.equal(erc20.approve(KYBER_ROUTER, "255"), "0x095ea7b3" + KYBER_ROUTER.slice(2).padStart(64, "0") + "ff".padStart(64, "0"));
  assert.equal(erc20.balanceOf("0xAbC0000000000000000000000000000000000001").slice(10), "abc0000000000000000000000000000000000001".padStart(64, "0"));
});

// ------------------------------------------------------------------ fetch palsu
type Handler = (url: string, body: { method?: string; params?: unknown[] } & Record<string, unknown>) => unknown;
function fakeFetch(h: Handler): Fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    calls.push(body.method ? `rpc:${body.method}` : `${init.method ?? "GET"} ${new URL(url).pathname}`);
    const out = h(url, body);
    return new Response(JSON.stringify(out), { status: out && typeof out === "object" && "__status" in out ? (out as { __status: number }).__status : 200 });
  }) as unknown as Fetch & { calls: string[] };
  f.calls = calls;
  return f;
}

const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WALLET = "0x00000000000000000000000000000000000000aa";
const rpcRes = (result: unknown) => ({ jsonrpc: "2.0", id: 1, result });

function evmFetch(o: { balance?: bigint; allowance?: bigint; router?: string; value?: string; revert?: boolean } = {}) {
  return fakeFetch((url, b) => {
    if (url.includes("/routes?")) return { code: 0, data: { routerAddress: o.router ?? KYBER_ROUTER, routeSummary: { amountIn: "1000", amountOut: "5000", amountInUsd: "10", amountOutUsd: "9.9", route: [[{ exchange: "uniswap<script>" }]] } } };
    if (url.includes("/route/build")) return { code: 0, data: { routerAddress: o.router ?? KYBER_ROUTER, data: "0xdeadbeef", amountOut: "4990", transactionValue: o.value ?? "1000" } };
    const call = (b.params?.[0] ?? {}) as { data?: string };
    switch (b.method) {
      case "eth_call":
        if (call.data === erc20.decimals) return rpcRes("0x6");
        if (call.data?.startsWith("0x70a08231")) return rpcRes("0x" + (o.balance ?? 10n ** 9n).toString(16));
        if (call.data?.startsWith("0xdd62ed3e")) return rpcRes("0x" + (o.allowance ?? 0n).toString(16));
        if (o.revert) return { jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted: Return amount is not enough" } };
        return rpcRes("0x");
      case "eth_getBalance":
        return rpcRes("0x" + (o.balance ?? 10n ** 18n).toString(16));
      case "eth_estimateGas":
        return rpcRes("0x186a0");
    }
    throw new Error("tak terduga " + url);
  });
}

test("EVM buy: quote → build → simulasi; minAmountOut dari slippage; label rute dibersihkan", async () => {
  const f = evmFetch();
  const q = await quote(f, { chain: "base", side: "buy", token: TOKEN.toUpperCase().replace("0X", "0x"), amount: "0.000000000000001", slippageBps: 100 });
  assert.equal(q.inputToken, NATIVE_EVM);
  assert.equal(q.outputToken, TOKEN);
  assert.equal(q.minAmountOut, "4950");
  assert.deepEqual(q.route, ["uniswapscript"]);
  assert.equal(q.priceImpactPct, 1);
  const r = await build(f, q, WALLET);
  assert.equal(r.kind, "evm");
  if (r.kind === "evm") {
    assert.equal(r.tx.to, KYBER_ROUTER);
    assert.equal(r.tx.value, "0x3e8");
    assert.equal(r.tx.gas, "0x1d4c0"); // +20%
  }
});

test("EVM: router asing / value tidak cocok / simulasi revert / saldo kurang → ditolak", async () => {
  const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: SwapError) => e.code);
  assert.equal(await code(quote(evmFetch({ router: "0x0000000000000000000000000000000000000bad" }), { chain: "base", side: "buy", token: TOKEN, amount: "1", slippageBps: 50 })), "TX_REJECTED");
  const q = await quote(evmFetch(), { chain: "base", side: "buy", token: TOKEN, amount: "0.000000000000001", slippageBps: 50 });
  assert.equal(await code(build(evmFetch({ value: "999999" }), q, WALLET)), "TX_REJECTED");
  assert.equal(await code(build(evmFetch({ revert: true }), q, WALLET)), "SIMULATION_FAILED");
  assert.equal(await code(build(evmFetch({ balance: 5n }), q, WALLET)), "INSUFFICIENT_BALANCE");
});

test("EVM sell token: allowance kurang → transaksi approve sejumlah swap (bukan unlimited)", async () => {
  const f = evmFetch({ allowance: 10n });
  const q = await quote(f, { chain: "bsc", side: "sell", token: TOKEN, amount: "0.001", slippageBps: 50 });
  assert.equal(q.amountIn, "1000");
  const r = await build(f, q, WALLET);
  assert.equal(r.kind, "evm-approval");
  if (r.kind === "evm-approval") {
    assert.equal(r.approval.to, TOKEN);
    assert.equal(r.approval.data, erc20.approve(KYBER_ROUTER, "1000"));
  }
  assert.ok(!f.calls.some((c) => c.includes("/route/build"))); // swap belum dibangun
});

test("Solana buy: Jupiter → periksa transaksi → simulasi; gagal simulasi = 422", async () => {
  const wallet = base58.encode(PAYER);
  const mk = (simErr: unknown) =>
    fakeFetch((url, b) => {
      if (url.includes("/quote?")) return { inAmount: "10000000", outAmount: "777", otherAmountThreshold: "770", priceImpactPct: "0.0123", routePlan: [{ swapInfo: { label: "Whirlpool" } }] };
      if (url.endsWith("/swap")) return { swapTransaction: legacyTx(PAYER, [JUP]), lastValidBlockHeight: 5 };
      if (b.method === "getTokenSupply") return rpcRes({ value: { decimals: 5 } });
      if (b.method === "getBalance") return rpcRes({ value: 10 ** 9 });
      if (b.method === "simulateTransaction") return rpcRes({ value: { err: simErr, logs: ["Program log: ok"] } });
      throw new Error("tak terduga " + url);
    });
  const f = mk(null);
  const q = await quote(f, { chain: "solana", side: "buy", token: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", amount: "0.01", slippageBps: 100 });
  assert.equal(q.inputToken, WSOL_MINT);
  assert.equal(q.priceImpactPct, 1.23);
  const r = await build(f, q, wallet);
  assert.equal(r.kind, "solana");
  const bad = await build(mk({ InstructionError: [3, { Custom: 6001 }] }), q, wallet).then(() => "ok", (e: SwapError) => e.code);
  assert.equal(bad, "SIMULATION_FAILED");
});
