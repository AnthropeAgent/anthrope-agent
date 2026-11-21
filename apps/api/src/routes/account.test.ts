import assert from "node:assert/strict";
import { test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { base58 } from "@scure/base";
import type { AuthNonce, Me, WatchlistItem } from "@ot/types";
import { buildApp } from "../app";
import { buildMessage, nonceOf, recoverEvm, toChecksumAddress, verifySolana } from "../auth/siwx";
import type { AuthStore, NonceData } from "../auth/store";
import type { TokenStore } from "./tokens";

const ORIGIN = "http://localhost:3000";

// ------------------------------------------------------------------ wallet uji
function solWallet() {
  const sk = ed25519.utils.randomPrivateKey();
  return { address: base58.encode(ed25519.getPublicKey(sk)), sign: (m: string) => base58.encode(ed25519.sign(utf8ToBytes(m), sk)) };
}
function evmWallet() {
  const sk = secp256k1.utils.randomPrivateKey();
  const address = "0x" + bytesToHex(keccak_256(secp256k1.getPublicKey(sk, false).slice(1)).slice(-20));
  const sign = (m: string) => {
    const msg = utf8ToBytes(m);
    const hash = keccak_256(new Uint8Array([...utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`), ...msg]));
    const sig = secp256k1.sign(hash, sk);
    return "0x" + sig.toCompactHex() + (27 + sig.recovery).toString(16);
  };
  return { address, sign };
}

// ------------------------------------------------------------------ store in-memory
function memoryAuth(): AuthStore & { nonces: Map<string, NonceData> } {
  const nonces = new Map<string, NonceData>();
  const users = new Map<string, Me>();
  const wallets = new Map<string, string>();
  const sessions = new Map<string, string>();
  const watch = new Map<string, WatchlistItem[]>();
  const hits = new Map<string, number>();
  let seq = 0;
  return {
    nonces,
    available: () => true,
    async putNonce(n, d) { nonces.set(n, d); },
    async takeNonce(n) { const d = nonces.get(n) ?? null; nonces.delete(n); return d; },
    async hit(k, limit) { const n = (hits.get(k) ?? 0) + 1; hits.set(k, n); return n <= limit; },
    async loginWallet(kind, address) {
      const k = `${kind}:${address}`;
      if (!wallets.has(k)) {
        const id = `00000000-0000-0000-0000-${String(++seq).padStart(12, "0")}`;
        wallets.set(k, id);
        users.set(id, { id, displayName: null, email: null, role: "user", wallets: [{ chainKind: kind, address }], preferences: {} });
      }
      return wallets.get(k)!;
    },
    async createSession(u, h) { sessions.set(h.toString("hex"), u); },
    async deleteSession(h) { sessions.delete(h.toString("hex")); },
    async sessionUser(h) { return sessions.get(h.toString("hex")) ?? null; },
    async getMe(u) { return users.get(u) ?? null; },
    async patchMe(u, p) {
      const me = users.get(u)!;
      if (p.displayName !== undefined) me.displayName = p.displayName;
      if (p.preferences) me.preferences = { ...me.preferences, ...p.preferences };
      return me;
    },
    async listWatchlist(u) { return watch.get(u) ?? []; },
    async addWatch(u, item, max) {
      const l = watch.get(u) ?? [];
      if (l.some((i) => i.kind === item.kind && i.chain === item.chain && i.address === item.address)) return "ok";
      if (l.length >= max) return "full";
      watch.set(u, [item, ...l]);
      return "ok";
    },
    async removeWatch(u, kind, chain, address) {
      watch.set(u, (watch.get(u) ?? []).filter((i) => !(i.kind === kind && i.chain === chain && i.address === address)));
    },
  };
}

const noTokens: TokenStore = {
  async getToken() { return null; },
  async getTokens() { return []; },
  async getList() { return []; },
  async requestToken() {},
  async getCandles() { return null; },
  async getTradeSeries() { return null; },
  async touchView() {},
};

function setup() {
  const auth = memoryAuth();
  const app = buildApp({ tokenStore: noTokens, authStore: auth, searchEngine: null, bus: null });
  const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: `/api/v1${url}`, payload: payload as object, headers: { origin: ORIGIN, ...headers } });
  return { app, auth, post };
}

async function login(post: ReturnType<typeof setup>["post"], kind: "solana" | "evm", w: { address: string; sign: (m: string) => string }) {
  const n = (await post("/auth/nonce", { chainKind: kind, address: w.address })).json<AuthNonce>();
  const r = await post("/auth/verify", { message: n.message, signature: w.sign(n.message) });
  const cookie = String(r.headers["set-cookie"] ?? "");
  return { r, n, cookie: cookie.split(";")[0] };
}

// ------------------------------------------------------------------ tes
test("SIWx: pesan EIP-4361, checksum EIP-55, verifikasi ed25519 & secp256k1", () => {
  assert.equal(toChecksumAddress("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"), "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
  const msg = buildMessage({
    kind: "evm", address: "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed", domain: "localhost:3000", uri: ORIGIN,
    appName: "Nova", nonce: "a".repeat(32), evmChainId: 8453, issuedAt: new Date("2026-01-01T00:00:00Z"),
  });
  assert.match(msg, /^localhost:3000 wants you to sign in with your Ethereum account:\n0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed\n\n/);
  assert.match(msg, /\nChain ID: 8453\n/);
  assert.match(msg, /\nExpiration Time: 2026-01-01T00:05:00.000Z$/);
  assert.equal(nonceOf(msg), "a".repeat(32));

  const s = solWallet();
  assert.ok(verifySolana(s.address, "hi", s.sign("hi")));
  assert.ok(!verifySolana(s.address, "hi!", s.sign("hi")));
  assert.ok(!verifySolana(solWallet().address, "hi", s.sign("hi")));
  const e = evmWallet();
  assert.equal(recoverEvm("hi", e.sign("hi")), e.address);
  assert.notEqual(recoverEvm("hi!", e.sign("hi")), e.address);
  assert.equal(recoverEvm("hi", "0x1234"), null);
});

test("login Solana & EVM → cookie sesi HttpOnly → /me; logout menghapus sesi", async () => {
  const { app, post } = setup();
  const sol = solWallet();
  const { r, n, cookie } = await login(post, "solana", sol);
  assert.equal(r.statusCode, 200, r.body);
  assert.match(n.message, /^localhost:3000 wants you to sign in with your Solana account:\n/);
  assert.match(String(r.headers["set-cookie"]), /^session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
  const me = (await app.inject({ url: "/api/v1/me", headers: { cookie } })).json<Me>();
  assert.deepEqual(me.wallets, [{ chainKind: "solana", address: sol.address }]);

  const evm = evmWallet();
  const e = await login(post, "evm", { address: toChecksumAddress(evm.address), sign: evm.sign });
  assert.equal(e.r.statusCode, 200, e.r.body);
  assert.equal(e.r.json<Me>().wallets[0].address, evm.address); // disimpan lowercase

  assert.equal((await post("/auth/logout", {}, { cookie })).statusCode, 204);
  assert.equal((await app.inject({ url: "/api/v1/me", headers: { cookie } })).statusCode, 401);
  assert.equal((await app.inject("/api/v1/me")).statusCode, 401);
  await app.close();
});

test("verify ditolak: tanda tangan wallet lain, pesan diubah, nonce dipakai ulang", async () => {
  const { app, post } = setup();
  const w = solWallet();
  const other = solWallet();

  let n = (await post("/auth/nonce", { chainKind: "solana", address: w.address })).json<AuthNonce>();
  let r = await post("/auth/verify", { message: n.message, signature: other.sign(n.message) });
  assert.equal(r.json<{ error: { code: string } }>().error.code, "INVALID_SIGNATURE");
  // nonce sudah habis walau gagal
  r = await post("/auth/verify", { message: n.message, signature: w.sign(n.message) });
  assert.equal(r.json<{ error: { code: string } }>().error.code, "NONCE_INVALID");

  n = (await post("/auth/nonce", { chainKind: "solana", address: w.address })).json<AuthNonce>();
  const tampered = n.message.replace("localhost:3000", "evil.example");
  r = await post("/auth/verify", { message: tampered, signature: w.sign(tampered) });
  assert.equal(r.statusCode, 401);

  n = (await post("/auth/nonce", { chainKind: "solana", address: w.address })).json<AuthNonce>();
  assert.equal((await post("/auth/verify", { message: n.message, signature: w.sign(n.message) })).statusCode, 200);
  assert.equal((await post("/auth/verify", { message: n.message, signature: w.sign(n.message) })).statusCode, 401); // replay

  assert.equal((await post("/auth/nonce", { chainKind: "evm", address: w.address })).statusCode, 400);
  assert.equal((await post("/auth/nonce", { chainKind: "solana", address: "0OIl" + w.address.slice(4) })).statusCode, 400);
  await app.close();
});

test("CSRF: origin lain / cross-site ditolak; login ulang merotasi sesi", async () => {
  const { app, post } = setup();
  const w = solWallet();
  assert.equal((await post("/auth/nonce", { chainKind: "solana", address: w.address }, { origin: "https://evil.example" })).statusCode, 403);
  assert.equal((await post("/auth/nonce", { chainKind: "solana", address: w.address }, { "sec-fetch-site": "cross-site" })).statusCode, 403);

  const a = await login(post, "solana", w);
  const n = (await post("/auth/nonce", { chainKind: "solana", address: w.address }, { cookie: a.cookie })).json<AuthNonce>();
  const b = await post("/auth/verify", { message: n.message, signature: w.sign(n.message) }, { cookie: a.cookie });
  const bCookie = String(b.headers["set-cookie"]).split(";")[0];
  assert.notEqual(bCookie, a.cookie);
  assert.equal((await app.inject({ url: "/api/v1/me", headers: { cookie: a.cookie } })).statusCode, 401); // sesi lama hangus
  assert.equal((await app.inject({ url: "/api/v1/me", headers: { cookie: bCookie } })).statusCode, 200);
  await app.close();
});

test("PATCH /me (whitelist preferensi) dan watchlist tambah/hapus/validasi", async () => {
  const { app, post } = setup();
  const { cookie } = await login(post, "solana", solWallet());
  const patch = (payload: unknown) => app.inject({ method: "PATCH", url: "/api/v1/me", payload: payload as object, headers: { cookie, origin: ORIGIN } });

  const ok = await patch({ displayName: " Dani ", preferences: { discoverColumns: ["price", "mc"], chartInterval: "15m" } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json<Me>().displayName, "Dani");
  assert.deepEqual(ok.json<Me>().preferences, { discoverColumns: ["price", "mc"], chartInterval: "15m" });
  assert.equal((await patch({ preferences: { evil: 1 } })).statusCode, 400);
  assert.equal((await patch({ role: "admin" })).statusCode, 400);
  assert.equal((await patch({ preferences: { discoverColumns: ["<script>"] } })).statusCode, 400);

  const WETH = "0x4200000000000000000000000000000000000006";
  const add = (p: unknown) => post("/me/watchlist", p, { cookie });
  assert.equal((await add({ kind: "token", chain: "base", address: WETH.toUpperCase().replace("0X", "0x") })).statusCode, 201);
  assert.equal((await add({ kind: "token", chain: "base", address: WETH })).statusCode, 201); // idempoten
  assert.equal((await add({ kind: "token", chain: "base", address: "nope" })).statusCode, 400);
  assert.equal((await add({ kind: "token", chain: "sui", address: WETH })).statusCode, 400);
  let list = (await app.inject({ url: "/api/v1/me/watchlist", headers: { cookie } })).json<{ items: WatchlistItem[] }>();
  assert.deepEqual(list.items.map((i) => i.address), [WETH]);

  const del = await app.inject({ method: "DELETE", url: `/api/v1/me/watchlist/token/base/${WETH}`, headers: { cookie, origin: ORIGIN } });
  assert.equal(del.statusCode, 204);
  list = (await app.inject({ url: "/api/v1/me/watchlist", headers: { cookie } })).json<{ items: WatchlistItem[] }>();
  assert.equal(list.items.length, 0);
  assert.equal((await post("/me/watchlist", { kind: "token", chain: "base", address: WETH })).statusCode, 401); // tanpa cookie
  await app.close();
});
