/** Chain yang bisa di-swap (langkah 6) beserta RPC & aggregator-nya. */
export const NATIVE_EVM = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"; // konvensi KyberSwap untuk koin native
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export interface SolanaSwapChain {
  kind: "solana";
  native: { symbol: "SOL"; address: string; decimals: 9 };
  rpc: () => string;
  explorerTx: string;
}
export interface EvmSwapChain {
  kind: "evm";
  chainId: number;
  kyber: string;
  native: { symbol: string; address: string; decimals: 18 };
  rpc: () => string;
  explorerTx: string;
}
export type SwapChain = SolanaSwapChain | EvmSwapChain;

export const SWAP_CHAINS = {
  solana: {
    kind: "solana",
    native: { symbol: "SOL", address: WSOL_MINT, decimals: 9 },
    rpc: () => process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    explorerTx: "https://solscan.io/tx/",
  },
  base: {
    kind: "evm",
    chainId: 8453,
    kyber: "base",
    native: { symbol: "ETH", address: NATIVE_EVM, decimals: 18 },
    rpc: () => process.env.BASE_RPC_URL || "https://mainnet.base.org",
    explorerTx: "https://basescan.org/tx/",
  },
  bsc: {
    kind: "evm",
    chainId: 56,
    kyber: "bsc",
    native: { symbol: "BNB", address: NATIVE_EVM, decimals: 18 },
    rpc: () => process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org",
    explorerTx: "https://bscscan.com/tx/",
  },
} as const satisfies Record<string, SwapChain>;

export type SwapChainId = keyof typeof SWAP_CHAINS;
export const isSwapChain = (c: string): c is SwapChainId => Object.hasOwn(SWAP_CHAINS, c);

const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
export function isAddressFor(chain: SwapChainId, a: string): boolean {
  return SWAP_CHAINS[chain].kind === "evm" ? EVM_RE.test(a) : SOLANA_RE.test(a);
}
export const normAddr = (chain: SwapChainId, a: string) => (SWAP_CHAINS[chain].kind === "evm" ? a.toLowerCase() : a);

/** Format tanda tangan / hash transaksi per chain. */
export function isTxId(chain: SwapChainId, s: string): boolean {
  return SWAP_CHAINS[chain].kind === "evm" ? /^0x[0-9a-fA-F]{64}$/.test(s) : /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(s);
}
