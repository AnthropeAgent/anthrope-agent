/**
 * Holders & security scan (langkah 7), Mode A.
 *
 * Sumber utama: GoPlus Security API (gratis, tanpa key; Solana + EVM). Untuk Solana ada fallback
 * RPC (mint/freeze authority, ekstensi Token-2022, 20 akun terbesar) bila GoPlus belum punya data,
 * misalnya token yang baru dibuat. Dipanggil HANYA dari worker (ARCHITECTURE §3).
 *
 * Semua data provider dianggap tidak tepercaya: angka dibersihkan, label dipotong, alamat divalidasi.
 */
import type { CheckStatus, Holder, HoldersSnapshot, SecurityCheck, SecurityReport, Token } from "@ot/types";
import { BRIDGE_CHAINS, type BridgeChain } from "./chains";
import { fetchJson, RateLimiter } from "./http";
import { cleanText, num } from "./sanitize";

const GOPLUS = "https://api.gopluslabs.io/api/v1";
const EVM_CHAIN_ID: Record<string, number> = { base: 8453, bsc: 56 };
/** GoPlus gratis ±30 panggilan/menit; disisakan ruang. */
export const goplusLimiter = new RateLimiter(2_500);
const rpcLimiter = new RateLimiter(400);

const BURN = new Set(["0x000000000000000000000000000000000000dead", "0x0000000000000000000000000000000000000000", "1nc1nerator11111111111111111111111111111111"]);
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

export interface ScanResult {
  report: SecurityReport;
  holders: HoldersSnapshot;
}

// ------------------------------------------------------------------ fakta mentah (sumber apa pun)
/** Fakta hasil pindai; null = tidak diketahui. Persentase dalam % (0..100). */
export interface SecurityFacts {
  honeypot: boolean | null;
  cannotSell: boolean | null;
  buyTax: number | null;
  sellTax: number | null;
  /** Solana: mint authority masih ada. EVM: kontrak punya fungsi mint. */
  mintable: boolean | null;
  /** Solana: freeze authority masih ada. */
  freezable: boolean | null;
  ownerRenounced: boolean | null;
  hiddenOwner: boolean | null;
  takeBackOwnership: boolean | null;
  proxy: boolean | null;
  blacklist: boolean | null;
  pausable: boolean | null;
  selfDestruct: boolean | null;
  openSource: boolean | null;
  /** Token-2022 */
  transferHook: boolean | null;
  transferFeePct: number | null;
  permanentDelegate: boolean | null;
  nonTransferable: boolean | null;
  metadataMutable: boolean | null;
  lpLockedPct: number | null;
  top10Pct: number | null;
  creatorPct: number | null;
  holderCount: number | null;
  creator: string | null;
  owner: string | null;
}

export const NO_FACTS: SecurityFacts = {
  honeypot: null, cannotSell: null, buyTax: null, sellTax: null, mintable: null, freezable: null, ownerRenounced: null,
  hiddenOwner: null, takeBackOwnership: null, proxy: null, blacklist: null, pausable: null, selfDestruct: null, openSource: null,
  transferHook: null, transferFeePct: null, permanentDelegate: null, nonTransferable: null, metadataMutable: null,
  lpLockedPct: null, top10Pct: null, creatorPct: null, holderCount: null, creator: null, owner: null,
};

// ------------------------------------------------------------------ skor
const yesNo = (v: boolean | null, yes = "Yes", no = "No") => (v == null ? "Belum diketahui" : v ? yes : no);
const pct = (v: number | null, d = 1) => (v == null ? "Belum diketahui" : `${v.toFixed(d)}%`);

/**
 * Skor 0..100 (100 = tidak ada temuan) + daftar pemeriksaan untuk UI.
 * Bobot sengaja sederhana dan transparan; tiap pemeriksaan menyebut alasannya.
 */
export function scoreFacts(chain: BridgeChain, f: SecurityFacts): { score: number | null; risk: SecurityReport["risk"]; checks: SecurityCheck[]; flags: string[] } {
  const checks: SecurityCheck[] = [];
  const flags: string[] = [];
  let score = 100;
  let known = 0;
  const add = (key: string, label: string, v: unknown, status: CheckStatus, value: string, penalty = 0) => {
    checks.push({ key, label, status: v == null ? "unknown" : status, value });
    if (v == null) return;
    known++;
    if (status !== "ok") {
      score -= penalty;
      flags.push(key);
    }
  };
  const solana = !BRIDGE_CHAINS[chain].evm;

  add("honeypot", "Honeypot", f.honeypot, f.honeypot ? "danger" : "ok", yesNo(f.honeypot, "Terdeteksi", "Tidak"), 100);
  if (!solana) add("cannot_sell", "Bisa dijual semua", f.cannotSell, f.cannotSell ? "danger" : "ok", yesNo(f.cannotSell == null ? null : !f.cannotSell, "Ya", "Tidak"), 40);
  const tax = f.buyTax == null && f.sellTax == null ? null : Math.max(f.buyTax ?? 0, f.sellTax ?? 0);
  add("tax", "Pajak beli / jual", tax, tax != null && tax > 10 ? "danger" : tax ? "warn" : "ok", tax == null ? "Belum diketahui" : `${(f.buyTax ?? 0).toFixed(1)}% / ${(f.sellTax ?? 0).toFixed(1)}%`, tax != null && tax > 10 ? 25 : 5);

  if (solana) {
    add("mint_authority", "Mint authority dicabut", f.mintable, f.mintable ? "danger" : "ok", yesNo(f.mintable == null ? null : !f.mintable), 25);
    add("freeze_authority", "Freeze authority dicabut", f.freezable, f.freezable ? "danger" : "ok", yesNo(f.freezable == null ? null : !f.freezable), 25);
    add("permanent_delegate", "Permanent delegate", f.permanentDelegate, f.permanentDelegate ? "danger" : "ok", yesNo(f.permanentDelegate, "Ada", "Tidak ada"), 30);
    add("transfer_hook", "Transfer hook", f.transferHook, f.transferHook ? "danger" : "ok", yesNo(f.transferHook, "Ada", "Tidak ada"), 20);
    add("transfer_fee", "Transfer fee", f.transferFeePct, f.transferFeePct ? "warn" : "ok", f.transferFeePct == null ? "Belum diketahui" : `${f.transferFeePct}%`, 10);
    add("non_transferable", "Non-transferable", f.nonTransferable, f.nonTransferable ? "danger" : "ok", yesNo(f.nonTransferable), 40);
    add("metadata_mutable", "Metadata bisa diubah", f.metadataMutable, f.metadataMutable ? "warn" : "ok", yesNo(f.metadataMutable), 5);
  } else {
    add("mintable", "Fungsi mint", f.mintable, f.mintable ? "warn" : "ok", yesNo(f.mintable, "Ada", "Tidak ada"), 15);
    add("owner_renounced", "Ownership dilepas", f.ownerRenounced, f.ownerRenounced ? "ok" : "warn", yesNo(f.ownerRenounced), 5);
    add("hidden_owner", "Hidden owner", f.hiddenOwner, f.hiddenOwner ? "danger" : "ok", yesNo(f.hiddenOwner, "Ada", "Tidak ada"), 20);
    add("take_back_ownership", "Bisa ambil alih ownership", f.takeBackOwnership, f.takeBackOwnership ? "danger" : "ok", yesNo(f.takeBackOwnership), 20);
    add("proxy", "Kontrak proxy (upgradeable)", f.proxy, f.proxy ? "warn" : "ok", yesNo(f.proxy), 10);
    add("blacklist", "Fungsi blacklist", f.blacklist, f.blacklist ? "warn" : "ok", yesNo(f.blacklist, "Ada", "Tidak ada"), 10);
    add("pausable", "Transfer bisa dihentikan", f.pausable, f.pausable ? "danger" : "ok", yesNo(f.pausable), 20);
    add("selfdestruct", "Self-destruct", f.selfDestruct, f.selfDestruct ? "danger" : "ok", yesNo(f.selfDestruct, "Ada", "Tidak ada"), 20);
    add("open_source", "Kode terverifikasi", f.openSource, f.openSource ? "ok" : "warn", yesNo(f.openSource), 10);
  }
  add("lp_locked", "LP terkunci / dibakar", f.lpLockedPct, f.lpLockedPct != null && f.lpLockedPct < 50 ? "warn" : "ok", pct(f.lpLockedPct), 10);
  add("top10", "Konsentrasi 10 holder teratas", f.top10Pct, f.top10Pct != null && f.top10Pct > 50 ? "danger" : f.top10Pct != null && f.top10Pct > 30 ? "warn" : "ok", pct(f.top10Pct), f.top10Pct != null && f.top10Pct > 50 ? 15 : 5);
  add("creator_holding", "Kepemilikan creator", f.creatorPct, f.creatorPct != null && f.creatorPct > 10 ? "warn" : "ok", pct(f.creatorPct, 2), 10);

  if (!known) return { score: null, risk: "unknown", checks, flags };
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (f.honeypot) score = 0;
  return { score, risk: score >= 70 ? "low" : score >= 40 ? "medium" : "high", checks, flags };
}

export function buildReport(chain: BridgeChain, address: string, f: SecurityFacts, source: string, now = new Date()): SecurityReport {
  const s = scoreFacts(chain, f);
  return {
    chain,
    address,
    ...s,
    summary: {
      score: s.score,
      mintRevoked: f.mintable == null ? null : !f.mintable,
      freezeRevoked: f.freezable == null ? null : !f.freezable,
      lpBurnedPct: f.lpLockedPct == null ? null : Math.round(f.lpLockedPct * 10) / 10,
      honeypot: f.honeypot,
      buyTax: f.buyTax,
      sellTax: f.sellTax,
    },
    holderCount: f.holderCount,
    top10Pct: f.top10Pct,
    creator: f.creator,
    owner: f.owner,
    source,
    scannedAt: now.toISOString(),
  };
}

// ------------------------------------------------------------------ holders
function validAddr(chain: BridgeChain, a: unknown): string | null {
  if (typeof a !== "string") return null;
  return BRIDGE_CHAINS[chain].evm ? (EVM_RE.test(a) ? a.toLowerCase() : null) : SOL_RE.test(a) ? a : null;
}

interface RawHolder {
  address: string;
  amount: number;
  pct: number;
  tag?: string;
  isContract?: boolean;
  locked?: boolean;
}

/** Urutkan, beri label, hitung nilai USD dan konsentrasi top 10 (LP/burn/terkunci tidak dihitung). */
export function finishHolders(chain: BridgeChain, raw: RawHolder[], priceUsd: number, lpAddrs: Set<string>, holderCount: number | null, source: string, now = new Date()): HoldersSnapshot {
  const items: Holder[] = raw
    .filter((h) => h.pct >= 0 && h.pct <= 100 && h.amount >= 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 100)
    .map((h, i) => {
      const burn = BURN.has(h.address.toLowerCase()) || BURN.has(h.address);
      const lp = lpAddrs.has(h.address);
      const label = burn ? "Burn" : lp ? "LP" : h.locked ? "Locked" : cleanText(h.tag, 24) || undefined;
      return {
        rank: i + 1,
        address: h.address,
        label,
        pct: Math.round(h.pct * 10_000) / 10_000,
        amount: h.amount,
        valueUsd: priceUsd > 0 ? h.amount * priceUsd : 0,
        isContract: h.isContract,
        locked: h.locked,
      };
    });
  const counted = items.filter((h) => h.label !== "Burn" && h.label !== "LP" && !h.locked).slice(0, 10);
  const top10Pct = items.length ? Math.round(counted.reduce((s, h) => s + h.pct, 0) * 100) / 100 : null;
  return { items, holderCount, top10Pct, source, updatedAt: now.toISOString() };
}

// ------------------------------------------------------------------ GoPlus
type Flag = string | number | undefined | null;
const bit = (v: Flag): boolean | null => (v === "1" || v === 1 ? true : v === "0" || v === 0 ? false : null);
const pctOf = (v: unknown): number | null => {
  const n = num(v);
  return n == null || n < 0 ? null : n * 100;
};

interface GpEvm {
  is_honeypot?: Flag; cannot_sell_all?: Flag; buy_tax?: string; sell_tax?: string; is_mintable?: Flag; owner_address?: string;
  hidden_owner?: Flag; can_take_back_ownership?: Flag; is_proxy?: Flag; is_blacklisted?: Flag; transfer_pausable?: Flag;
  selfdestruct?: Flag; is_open_source?: Flag; holder_count?: string; creator_address?: string; creator_percent?: string;
  holders?: { address?: string; tag?: string; is_contract?: number; balance?: string; percent?: string; is_locked?: number }[];
  lp_holders?: { address?: string; percent?: string; is_locked?: number }[];
  dex?: { pair?: string }[];
}

export function fromGoplusEvm(chain: BridgeChain, address: string, r: GpEvm, priceUsd: number, now = new Date()): ScanResult {
  const lpAddrs = new Set((r.dex ?? []).map((d) => validAddr(chain, d.pair)).filter((a): a is string => !!a));
  const lpLocked = r.lp_holders?.length
    ? (r.lp_holders ?? []).filter((h) => h.is_locked === 1 || BURN.has(String(h.address).toLowerCase())).reduce((s, h) => s + (pctOf(h.percent) ?? 0), 0)
    : null;
  const raw: RawHolder[] = (r.holders ?? []).flatMap((h) => {
    const a = validAddr(chain, h.address);
    const p = pctOf(h.percent);
    const amt = num(h.balance);
    return a && p != null && amt != null ? [{ address: a, amount: amt, pct: p, tag: h.tag, isContract: h.is_contract === 1, locked: h.is_locked === 1 }] : [];
  });
  const holderCount = num(r.holder_count);
  const holders = finishHolders(chain, raw, priceUsd, lpAddrs, holderCount, "goplus", now);
  const owner = validAddr(chain, r.owner_address);
  const tax = (v: unknown) => {
    const n = num(v);
    return n == null ? null : Math.round(n * 1000) / 10;
  };
  const facts: SecurityFacts = {
    ...NO_FACTS,
    honeypot: bit(r.is_honeypot),
    cannotSell: bit(r.cannot_sell_all),
    buyTax: tax(r.buy_tax),
    sellTax: tax(r.sell_tax),
    mintable: bit(r.is_mintable),
    ownerRenounced: r.owner_address === undefined ? null : !owner || BURN.has(owner),
    hiddenOwner: bit(r.hidden_owner),
    takeBackOwnership: bit(r.can_take_back_ownership),
    proxy: bit(r.is_proxy),
    blacklist: bit(r.is_blacklisted),
    pausable: bit(r.transfer_pausable),
    selfDestruct: bit(r.selfdestruct),
    openSource: bit(r.is_open_source),
    lpLockedPct: lpLocked == null ? null : Math.min(100, lpLocked),
    top10Pct: holders.top10Pct,
    creatorPct: pctOf(r.creator_percent),
    holderCount,
    creator: validAddr(chain, r.creator_address),
    owner: owner && !BURN.has(owner) ? owner : null,
  };
  return { report: buildReport(chain, address, facts, "goplus", now), holders };
}

interface GpAuth {
  status?: Flag;
  authority?: unknown[];
}
interface GpSol {
  mintable?: GpAuth; freezable?: GpAuth; balance_mutable_authority?: GpAuth; metadata_mutable?: GpAuth;
  transfer_hook?: unknown[]; transfer_fee?: { fee_rate?: unknown } | Record<string, unknown>; non_transferable?: Flag;
  holder_count?: string; creators?: { address?: string }[];
  holders?: { account?: string; tag?: string; balance?: string; percent?: string; is_locked?: number }[];
  lp_holders?: { account?: string; percent?: string; is_locked?: number }[];
  dex?: { id?: string; burn_percent?: unknown }[];
}

export function fromGoplusSolana(address: string, r: GpSol, priceUsd: number, now = new Date()): ScanResult {
  const chain: BridgeChain = "solana";
  const lpAddrs = new Set((r.dex ?? []).map((d) => validAddr(chain, d.id)).filter((a): a is string => !!a));
  const raw: RawHolder[] = (r.holders ?? []).flatMap((h) => {
    const a = validAddr(chain, h.account);
    const p = pctOf(h.percent);
    const amt = num(h.balance);
    return a && p != null && amt != null ? [{ address: a, amount: amt, pct: p, tag: h.tag, locked: h.is_locked === 1 }] : [];
  });
  const holderCount = num(r.holder_count);
  const holders = finishHolders(chain, raw, priceUsd, lpAddrs, holderCount, "goplus", now);
  // LP Solana: pakai burn_percent pool terbesar bila ada (AMM v4/CPMM); pool CLMM tidak punya LP token.
  const burns = (r.dex ?? []).map((d) => num(d.burn_percent)).filter((n): n is number => n != null);
  const fee = num((r.transfer_fee as { fee_rate?: unknown } | undefined)?.fee_rate);
  const creator = validAddr(chain, r.creators?.[0]?.address);
  const facts: SecurityFacts = {
    ...NO_FACTS,
    honeypot: null,
    mintable: bit(r.mintable?.status),
    freezable: bit(r.freezable?.status),
    permanentDelegate: bit(r.balance_mutable_authority?.status),
    transferHook: Array.isArray(r.transfer_hook) ? r.transfer_hook.length > 0 : null,
    transferFeePct: r.transfer_fee ? (fee == null ? 0 : fee / 100) : null,
    nonTransferable: bit(r.non_transferable),
    metadataMutable: bit(r.metadata_mutable?.status),
    lpLockedPct: burns.length ? Math.min(100, Math.max(...burns)) : null,
    top10Pct: holders.top10Pct,
    holderCount,
    creator,
  };
  return { report: buildReport(chain, address, facts, "goplus", now), holders };
}

type GpBody<T> = { code?: number; message?: string; result?: Record<string, T> | null };

/** null bila GoPlus belum mengenal token (respons kosong). */
export async function goplusScan(chain: BridgeChain, address: string, priceUsd: number): Promise<ScanResult | null> {
  if (chain === "solana") {
    const body = await fetchJson<GpBody<GpSol>>(`${GOPLUS}/solana/token_security?contract_addresses=${address}`, { provider: "goplus", limiter: goplusLimiter });
    const r = body.result?.[address];
    return r && (r.holders?.length || r.mintable) ? fromGoplusSolana(address, r, priceUsd) : null;
  }
  const id = EVM_CHAIN_ID[chain];
  if (!id) return null;
  const body = await fetchJson<GpBody<GpEvm>>(`${GOPLUS}/token_security/${id}?contract_addresses=${address}`, { provider: "goplus", limiter: goplusLimiter });
  const r = body.result?.[address.toLowerCase()];
  return r && Object.keys(r).length ? fromGoplusEvm(chain, address, r, priceUsd) : null;
}

// ------------------------------------------------------------------ Solana RPC (fallback)
interface ParsedMint {
  mintAuthority: string | null;
  freezeAuthority: string | null;
  supply: string;
  decimals: number;
  extensions?: { extension: string; state?: { newerTransferFee?: { transferFeeBasisPoints?: number } } }[];
}

async function solRpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await rpcLimiter.schedule(() =>
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10_000) }),
  );
  if (!res.ok) throw new Error(`solana rpc ${method}: HTTP ${res.status}`);
  const j = (await res.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(`solana rpc ${method}: ${cleanText(j.error.message, 120)}`);
  return j.result as T;
}

/** Fakta dari akun mint: authority, ekstensi Token-2022. */
export function factsFromMint(m: ParsedMint): Partial<SecurityFacts> {
  const ext = new Set((m.extensions ?? []).map((e) => e.extension));
  const feeBps = (m.extensions ?? []).find((e) => e.extension === "transferFeeConfig")?.state?.newerTransferFee?.transferFeeBasisPoints;
  return {
    mintable: m.mintAuthority != null,
    freezable: m.freezeAuthority != null,
    transferHook: ext.has("transferHook"),
    permanentDelegate: ext.has("permanentDelegate"),
    nonTransferable: ext.has("nonTransferable"),
    transferFeePct: feeBps == null ? 0 : feeBps / 100,
  };
}

export async function solanaRpcScan(rpcUrl: string, mint: string, priceUsd: number, now = new Date()): Promise<ScanResult> {
  const info = await solRpc<{ value: { data: { parsed?: { type: string; info: ParsedMint } } } | null }>(rpcUrl, "getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const parsed = info.value?.data?.parsed;
  if (!parsed || parsed.type !== "mint") throw new Error("bukan akun mint SPL");
  const m = parsed.info;
  const supply = Number(m.supply) / 10 ** m.decimals;

  // RPC publik sering menolak getTokenLargestAccounts untuk token dengan sangat banyak akun (429):
  // hasil authority tetap dipakai, holders kosong.
  const largest = await solRpc<{ value: { address: string; uiAmount: number | null }[] }>(rpcUrl, "getTokenLargestAccounts", [mint]).catch(() => ({ value: [] }));
  const accts = largest.value.slice(0, 20);
  const owners = accts.length
    ? await solRpc<{ value: ({ data: { parsed?: { info?: { owner?: string } } } } | null)[] }>(rpcUrl, "getMultipleAccounts", [accts.map((a) => a.address), { encoding: "jsonParsed" }])
    : { value: [] };
  const byOwner = new Map<string, number>();
  accts.forEach((a, i) => {
    const owner = validAddr("solana", owners.value[i]?.data?.parsed?.info?.owner) ?? a.address;
    byOwner.set(owner, (byOwner.get(owner) ?? 0) + (a.uiAmount ?? 0));
  });
  const raw: RawHolder[] = [...byOwner].map(([address, amount]) => ({ address, amount, pct: supply > 0 ? (amount / supply) * 100 : 0 }));
  const holders = finishHolders("solana", raw, priceUsd, new Set(), null, "solana-rpc", now);
  const facts: SecurityFacts = { ...NO_FACTS, ...factsFromMint(m), top10Pct: holders.top10Pct };
  return { report: buildReport("solana", mint, facts, "solana-rpc", now), holders };
}

/** Pindai satu token: GoPlus dulu, lalu RPC (Solana) bila GoPlus belum punya data atau gagal. */
export async function scanToken(chain: BridgeChain, address: string, token: Pick<Token, "price"> | null, opts: { solanaRpc: string }): Promise<ScanResult | null> {
  const price = token?.price ?? 0;
  let gp: ScanResult | null = null;
  let gpErr: unknown = null;
  try {
    gp = await goplusScan(chain, address, price);
  } catch (e) {
    gpErr = e;
  }
  if (gp) return gp;
  if (chain === "solana") return solanaRpcScan(opts.solanaRpc, address, price);
  if (gpErr) throw gpErr;
  return null;
}
