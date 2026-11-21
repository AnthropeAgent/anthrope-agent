/** Akun & data user (langkah 5): login wallet SIWS/SIWE, watchlist, preferensi. */
import type { Token } from "./market";

export type ChainKind = "solana" | "evm";
export type UserRole = "user" | "pro" | "peak" | "admin";

/** Preferensi yang disimpan per akun (whitelist; divalidasi di api). */
export interface UserPreferences {
  /** Kolom tabel Discover yang ditampilkan. */
  discoverColumns?: string[];
  /** Interval chart terakhir di halaman token. */
  chartInterval?: string;
}

export interface Me {
  id: string;
  displayName: string | null;
  email: string | null;
  role: UserRole;
  wallets: { chainKind: ChainKind; address: string }[];
  preferences: UserPreferences;
}

export interface WatchlistItem {
  kind: "token" | "wallet";
  chain: string;
  address: string;
  note?: string | null;
  createdAt?: string;
  /** Snapshot token dari cache (hanya kind=token, bila ada). */
  token?: Token | null;
}

export interface AuthNonce {
  message: string;
  nonce: string;
  expiresAt: string;
}
