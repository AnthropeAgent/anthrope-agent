import type { ChainId } from "@ot/types";

export type { ChainId };

export interface ChainMeta {
  id: ChainId;
  name: string;
  short: string;
  color: string;
  native: string;
  explorer: string;
  trenches: boolean;
}

/** Ikon chain dari CDN publik DefiLlama (bila gagal dimuat, UI kembali ke huruf berwarna). */
const ICON_SLUG: Partial<Record<string, string>> = {
  solana: "solana", robinhood: "robinhood", bsc: "binance", base: "base", ethereum: "ethereum", arbitrum: "arbitrum",
  avalanche: "avalanche", polygon: "polygon", sui: "sui", optimism: "optimism", monad: "monad", hyperevm: "hyperliquid",
};
export const chainIcon = (id: string): string | null => (ICON_SLUG[id] ? `https://icons.llamao.fi/icons/chains/rsz_${ICON_SLUG[id]}.jpg` : null);

export const CHAINS: ChainMeta[] = [
  { id: "solana", name: "Solana", short: "SOL", color: "#9945FF", native: "SOL", explorer: "https://solscan.io/token/", trenches: true },
  { id: "robinhood", name: "Robinhood", short: "HOOD", color: "#CCFF00", native: "ETH", explorer: "#", trenches: false },
  { id: "bsc", name: "BNB Chain", short: "BNB", color: "#F0B90B", native: "BNB", explorer: "https://bscscan.com/token/", trenches: false },
  { id: "base", name: "Base", short: "BASE", color: "#0052FF", native: "ETH", explorer: "https://basescan.org/token/", trenches: false },
  { id: "ethereum", name: "Ethereum", short: "ETH", color: "#627EEA", native: "ETH", explorer: "https://etherscan.io/token/", trenches: false },
  { id: "arbitrum", name: "Arbitrum", short: "ARB", color: "#28A0F0", native: "ETH", explorer: "https://arbiscan.io/token/", trenches: false },
  { id: "avalanche", name: "Avalanche", short: "AVAX", color: "#E84142", native: "AVAX", explorer: "https://snowtrace.io/token/", trenches: false },
  { id: "polygon", name: "Polygon", short: "POL", color: "#8247E5", native: "POL", explorer: "https://polygonscan.com/token/", trenches: false },
  { id: "sui", name: "Sui", short: "SUI", color: "#4DA2FF", native: "SUI", explorer: "#", trenches: false },
  { id: "optimism", name: "Optimism", short: "OP", color: "#FF0420", native: "ETH", explorer: "https://optimistic.etherscan.io/token/", trenches: false },
  { id: "monad", name: "Monad", short: "MON", color: "#836EF9", native: "MON", explorer: "#", trenches: false },
  { id: "hyperevm", name: "HyperEVM", short: "HYPE", color: "#97FCE4", native: "HYPE", explorer: "#", trenches: false },
];

export const chainById = (id: string) => CHAINS.find((c) => c.id === id);
