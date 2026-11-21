import type { ChainId } from "@ot/types";

/** Chain yang dicakup provider gratis (Mode A). Robinhood Chain belum tersedia di kedua provider. */
export const BRIDGE_CHAINS = {
  solana: { gt: "solana", ds: "solana", evm: false },
  base: { gt: "base", ds: "base", evm: true },
  bsc: { gt: "bsc", ds: "bsc", evm: true },
} as const satisfies Partial<Record<ChainId, { gt: string; ds: string; evm: boolean }>>;

export type BridgeChain = keyof typeof BRIDGE_CHAINS;

export function isBridgeChain(c: string): c is BridgeChain {
  return Object.hasOwn(BRIDGE_CHAINS, c);
}

/** Alamat EVM disimpan lowercase; Solana (base58) case-sensitive. */
export function normAddress(chain: BridgeChain, address: string): string {
  return BRIDGE_CHAINS[chain].evm ? address.toLowerCase() : address;
}

const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

export function isValidAddress(chain: BridgeChain, address: string): boolean {
  return BRIDGE_CHAINS[chain].evm ? EVM_RE.test(address) : SOLANA_RE.test(address);
}

/** Alamat pool: Solana base58, EVM 0x+40 hex, atau pool id 32 byte (Uniswap v4: 0x+64 hex). */
const POOL_RE = /^(0x[0-9a-fA-F]{40}|0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;
export function isValidPool(chain: BridgeChain, pool: string): boolean {
  return POOL_RE.test(pool) && (BRIDGE_CHAINS[chain].evm ? pool.startsWith("0x") : !pool.startsWith("0x"));
}
