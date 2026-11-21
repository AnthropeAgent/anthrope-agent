/**
 * Wallet analytics Mode A (langkah 8).
 * - traders (tiap 60 dtk): Top Traders per token & global dari semua deret trades yang dipantau.
 *   Supaya data global tidak hanya dari token yang kebetulan dibuka, 3 token trending teratas per chain
 *   ikut ditandai "dilihat" (worker charts mengambil trades-nya; ±1 panggilan GeckoTerminal/menit tambahan).
 * - wallets (tiap 5 dtk): profil wallet yang sedang dibuka (saldo RPC + harga cache + PnL terpantau).
 */
import { dexscreener, isBridgeChain, store, traders, wallet, type BridgeChain } from "@ot/bridge";
import { SWAP_CHAINS } from "@ot/swap";
import type { Token, WalletHolding, WalletProfile } from "@ot/types";

const WALLET_MAX_AGE_MS = 60_000;
const MAX_WALLETS_PER_CYCLE = 2;
const SEED_PER_CHAIN = 3;
/** Token tanpa harga di cache: maks 60 dicari di DexScreener (2 panggilan); pair < $1K likuiditas diabaikan. */
const MAX_PRICE_LOOKUP = 60;
const MIN_PRICE_LIQUIDITY = 1_000;
const CHAINS: BridgeChain[] = ["solana", "base", "bsc"];
const NATIVE: Record<BridgeChain, { symbol: string; ref: string }> = {
  solana: { symbol: "SOL", ref: "So11111111111111111111111111111111111111112" },
  base: { symbol: "ETH", ref: "0x4200000000000000000000000000000000000006" },
  bsc: { symbol: "BNB", ref: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c" },
};

async function seriesWithPrices() {
  const all = await store.allTradeSeries();
  const keys = [...all.keys()];
  const toks = new Map((await store.getTokens(keys)).map((t) => [`${t.chain}:${t.address}`, t]));
  return keys.map((k) => {
    const [chain, ...rest] = k.split(":");
    const address = rest.join(":");
    const t = toks.get(k);
    return { chain, address, symbol: t?.symbol ?? "?", priceUsd: t?.price ?? 0, trades: all.get(k)!.items };
  });
}

export async function aggregateTraders(log: (m: string) => void): Promise<void> {
  for (const chain of CHAINS) {
    const list = (await store.getList(chain, "trending")).slice(0, SEED_PER_CHAIN);
    for (const k of list) await store.touchView("trades", chain, k.slice(chain.length + 1));
  }
  const series = await seriesWithPrices();
  const now = Date.now();
  const updatedAt = new Date(now).toISOString();
  for (const s of series) {
    await store.putTraders(`${s.chain}:${s.address}`, { items: traders.tokenTraders(s.trades, s.priceUsd, now), updatedAt, tokens: 1 });
  }
  const global = traders.globalTraders(series, now);
  await store.putTraders("all", { items: global, updatedAt, tokens: series.length });
  log(`traders: ${series.length} token, ${global.length} wallet global`);
}

async function nativePrice(chain: BridgeChain): Promise<number | null> {
  const t = await store.getToken(chain, NATIVE[chain].ref);
  return t?.price ?? null;
}

function holding(chain: string, address: string, amount: number, t: Token | undefined): WalletHolding {
  const priceUsd = t?.price ?? null;
  return { chain, address, symbol: t?.symbol ?? "?", name: t?.name ?? "Unknown token", logoUrl: t?.logoUrl, amount, priceUsd, valueUsd: priceUsd == null ? null : amount * priceUsd };
}

/** Lengkapi harga/simbol token yang tidak ada di cache lewat DexScreener (worker-only). */
async function priceUnknown(chain: BridgeChain, list: WalletHolding[]): Promise<void> {
  const unknown = list.filter((h) => h.chain === chain && !h.native && h.priceUsd == null).slice(0, MAX_PRICE_LOOKUP);
  for (let i = 0; i < unknown.length; i += dexscreener.DS_BATCH) {
    const chunk = unknown.slice(i, i + dexscreener.DS_BATCH);
    const pairs = await dexscreener.pairsForTokens(chain, chunk.map((h) => h.address)).catch(() => new Map<string, dexscreener.DsPair[]>());
    for (const h of chunk) {
      const best = (pairs.get(h.address) ?? []).filter((p) => (p.liquidityUsd ?? 0) >= MIN_PRICE_LIQUIDITY && p.priceUsd != null).sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))[0];
      if (!best) continue;
      h.symbol = best.base.symbol || h.symbol;
      h.name = best.base.name || h.name;
      h.logoUrl = best.imageUrl ?? h.logoUrl;
      h.priceUsd = best.priceUsd;
      h.valueUsd = h.amount * best.priceUsd!;
    }
  }
}

export async function buildProfile(address: string): Promise<WalletProfile> {
  const evm = address.startsWith("0x");
  const chains: BridgeChain[] = evm ? ["base", "bsc"] : ["solana"];
  const allSeries = await seriesWithPrices();
  const holdings: WalletHolding[] = [];
  const notes: string[] = [];
  for (const chain of chains) {
    try {
      let bal;
      if (evm) {
        // Token yang dipantau discovery + token yang deret trades-nya ada (dibuka user / trending)
        const watched = allSeries.filter((s) => s.chain === chain).map((s) => s.address);
        const known = [...new Set([...watched, ...Object.keys(await store.getKnown(chain))])].slice(0, 400);
        bal = await wallet.evmBalances(SWAP_CHAINS[chain].rpc(), address, known);
      } else {
        bal = await wallet.solanaBalances(SWAP_CHAINS.solana.rpc(), address);
      }
      const np = await nativePrice(chain);
      if (bal.native > 0) holdings.push({ chain, address: "native", symbol: NATIVE[chain].symbol, name: NATIVE[chain].symbol, amount: bal.native, priceUsd: np, valueUsd: np == null ? null : bal.native * np, native: true });
      const toks = new Map((await store.getTokens(bal.tokens.map((b) => `${chain}:${b.token}`))).map((t) => [t.address, t]));
      for (const b of bal.tokens) holdings.push(holding(chain, b.token, b.amount, toks.get(b.token)));
      await priceUnknown(chain, holdings);
    } catch (e) {
      notes.push(`Saldo ${chain} gagal diambil (${(e as Error).message.slice(0, 80)})`);
    }
  }
  if (evm) notes.push("Saldo ERC-20 hanya untuk token yang dipantau platform; token lain butuh indexer (Mode B).");
  notes.push("PnL dihitung dari transaksi yang terpantau platform (pool utama token aktif), bukan riwayat penuh wallet.");
  holdings.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));

  const series = allSeries.filter((s) => isBridgeChain(s.chain) && chains.includes(s.chain as BridgeChain));
  const { tokens, activity } = traders.walletPnl(series, address);
  const realizedUsd = tokens.reduce((s, t) => s + t.realizedUsd, 0);
  const unrealizedUsd = tokens.reduce((s, t) => s + t.unrealizedUsd, 0);
  return {
    address,
    kind: evm ? "evm" : "solana",
    netWorthUsd: holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0),
    holdings: holdings.slice(0, 200),
    pnl: {
      realizedUsd,
      unrealizedUsd,
      totalUsd: realizedUsd + unrealizedUsd,
      winRate: tokens.length ? (tokens.filter((t) => t.pnlUsd > 0).length / tokens.length) * 100 : null,
      tokensTraded: tokens.length,
      volumeUsd: tokens.reduce((s, t) => s + t.boughtUsd + t.soldUsd, 0),
    },
    tokens,
    activity,
    notes,
    updatedAt: new Date().toISOString(),
  };
}

export async function refreshWallets(log: (m: string) => void): Promise<void> {
  const now = Date.now();
  const due = (await store.activeViews())
    .filter((v) => v.kind === "wallet" && now - v.updatedAt > WALLET_MAX_AGE_MS)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, MAX_WALLETS_PER_CYCLE);
  for (const v of due) {
    const p = await buildProfile(v.address);
    await store.putWallet(p);
    log(`wallet ${v.address.slice(0, 8)}…: ${p.holdings.length} aset, ${p.tokens.length} token diperdagangkan`);
  }
}
