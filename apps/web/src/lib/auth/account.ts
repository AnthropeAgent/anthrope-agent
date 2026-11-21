"use client";

/**
 * State akun di browser (langkah 5): sesi, watchlist, preferensi.
 * Satu store untuk semua komponen (useSyncExternalStore); data asli ada di api (/api/v1/me...).
 * Cookie sesi HttpOnly: JS tidak pernah melihat ID sesi, hanya hasil /me.
 */
import { useSyncExternalStore } from "react";
import type { AuthNonce, Me, UserPreferences, WatchlistItem } from "@ot/types";
import type { WalletOption } from "./wallets";

export interface AccountState {
  /** undefined = sedang dimuat, null = belum login. */
  me: Me | null | undefined;
  watchlist: WatchlistItem[];
}

let state: AccountState = { me: undefined, watchlist: [] };
const listeners = new Set<() => void>();
const set = (patch: Partial<AccountState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export class AccountError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new AccountError(res.status, e?.error?.code ?? "HTTP_ERROR", e?.error?.message ?? `HTTP ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const watchKey = (kind: string, chain: string, address: string) => `${kind}:${chain}:${address.toLowerCase()}`;

let loading: Promise<void> | null = null;
/** Muat sesi + watchlist (sekali; panggil lagi dengan force setelah login/logout). */
export function loadAccount(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = (async () => {
    try {
      const me = await call<Me>("GET", "/me");
      const { items } = await call<{ items: WatchlistItem[] }>("GET", "/me/watchlist");
      set({ me, watchlist: items });
    } catch (e) {
      // 401 = belum login; error lain (api mati) juga diperlakukan belum login, tanpa memblokir UI
      if (!(e instanceof AccountError && e.status === 401)) console.warn("akun:", e);
      set({ me: null, watchlist: [] });
    }
  })();
  return loading;
}

/** Login dengan wallet: connect → minta pesan → tanda tangan → verify (cookie di-set server). */
export async function loginWithWallet(w: WalletOption): Promise<Me> {
  const { address, chainId } = await w.connect();
  const n = await call<AuthNonce>("POST", "/auth/nonce", { chainKind: w.kind, address, chainId });
  const signature = await w.sign(n.message);
  const me = await call<Me>("POST", "/auth/verify", { message: n.message, signature });
  set({ me });
  await loadAccount(true);
  return me;
}

export async function logout(): Promise<void> {
  await call("POST", "/auth/logout", {}).catch(() => {});
  set({ me: null, watchlist: [] });
}

/** Cek dari snapshot useAccount() (bukan state modul) supaya hasil render server & hydration sama. */
export function inWatchlist(list: WatchlistItem[], kind: "token" | "wallet", chain: string, address: string): boolean {
  const k = watchKey(kind, chain, address);
  return list.some((i) => watchKey(i.kind, i.chain, i.address) === k);
}

/**
 * Tambah/hapus dari watchlist (optimistic). Mengembalikan "login" bila belum login
 * (pemanggil mengarahkan ke halaman login).
 */
export async function toggleWatch(kind: "token" | "wallet", chain: string, address: string): Promise<"ok" | "login"> {
  if (!state.me) return "login";
  const before = state.watchlist;
  const k = watchKey(kind, chain, address);
  const on = before.some((i) => watchKey(i.kind, i.chain, i.address) === k);
  set({ watchlist: on ? before.filter((i) => watchKey(i.kind, i.chain, i.address) !== k) : [{ kind, chain, address }, ...before] });
  try {
    if (on) await call("DELETE", `/me/watchlist/${kind}/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`);
    else await call("POST", "/me/watchlist", { kind, chain, address });
    // ambil ulang supaya snapshot token (harga) ikut terisi
    const { items } = await call<{ items: WatchlistItem[] }>("GET", "/me/watchlist");
    set({ watchlist: items });
  } catch (e) {
    set({ watchlist: before });
    if (e instanceof AccountError && e.status === 401) {
      set({ me: null });
      return "login";
    }
    throw e;
  }
  return "ok";
}

let prefTimer: ReturnType<typeof setTimeout> | null = null;
let prefPending: UserPreferences = {};
/** Simpan preferensi ke akun (digabung & ditunda 800 ms). Tanpa login: tidak melakukan apa-apa. */
export function savePreferences(p: UserPreferences) {
  if (!state.me) return;
  set({ me: { ...state.me, preferences: { ...state.me.preferences, ...p } } });
  prefPending = { ...prefPending, ...p };
  if (prefTimer) clearTimeout(prefTimer);
  prefTimer = setTimeout(() => {
    const body = prefPending;
    prefPending = {};
    call<Me>("PATCH", "/me", { preferences: body }).catch((e) => console.warn("simpan preferensi:", e));
  }, 800);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  if (state.me === undefined) void loadAccount();
  return () => listeners.delete(l);
};
const SERVER_STATE: AccountState = { me: undefined, watchlist: [] };

export function useAccount(): AccountState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE,
  );
}
