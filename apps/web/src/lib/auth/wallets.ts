/**
 * Deteksi wallet browser tanpa SDK:
 * - EVM: EIP-6963 (MetaMask, Rabby, Coinbase, Phantom EVM, ...) + fallback window.ethereum.
 * - Solana: Wallet Standard (Phantom, Solflare, Backpack, ...), fitur standard:connect + solana:signMessage.
 *
 * Wallet hanya diminta: alamat dan tanda tangan atas pesan login (tidak ada transaksi, tidak ada biaya).
 */
import { base58 } from "@scure/base";
import type { ChainKind } from "@ot/types";

export interface WalletOption {
  id: string;
  name: string;
  /** data:image/... dari wallet (sudah disaring), atau null. */
  icon: string | null;
  kind: ChainKind;
  /** Hubungkan wallet → alamat; lalu tanda tangani pesan dari server. */
  connect(): Promise<{ address: string; chainId?: number }>;
  sign(message: string): Promise<string>;
  /** Swap (langkah 6): tanda tangani + kirim transaksi yang dibangun server. Hasil: signature/hash. */
  sendSolana?(txBase64: string): Promise<string>;
  sendEvm?(tx: EvmTxRequest): Promise<string>;
  /** EVM: tunggu receipt lewat provider wallet (true = sukses). */
  waitEvm?(hash: string, timeoutMs?: number): Promise<boolean>;
}

export interface EvmTxRequest {
  chainId: number;
  from: string;
  to: string;
  data: string;
  value: string;
  gas?: string;
}

const safeIcon = (s: unknown) => (typeof s === "string" && /^data:image\/(png|svg\+xml|jpeg|webp|gif);/.test(s) && s.length < 200_000 ? s : null);

// ------------------------------------------------------------------ EVM (EIP-1193 / EIP-6963)
interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193;
}

function evmOption(id: string, name: string, icon: string | null, provider: Eip1193): WalletOption {
  let account = "";
  return {
    id: `evm:${id}`,
    name,
    icon,
    kind: "evm",
    async connect() {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts?.[0]) throw new Error("Wallet tidak memberi alamat");
      account = accounts[0];
      const chainHex = (await provider.request({ method: "eth_chainId" }).catch(() => null)) as string | null;
      const chainId = chainHex ? parseInt(chainHex, 16) : undefined;
      return { address: account, chainId: chainId && Number.isFinite(chainId) ? chainId : undefined };
    },
    async sign(message) {
      const hex = "0x" + Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, "0")).join("");
      return (await provider.request({ method: "personal_sign", params: [hex, account] })) as string;
    },
    async sendEvm(tx) {
      const want = "0x" + tx.chainId.toString(16);
      const cur = (await provider.request({ method: "eth_chainId" }).catch(() => null)) as string | null;
      if (cur?.toLowerCase() !== want) await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: tx.from, to: tx.to, data: tx.data, value: tx.value, ...(tx.gas ? { gas: tx.gas } : {}) }],
      })) as string;
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Wallet tidak mengembalikan hash transaksi");
      return hash;
    },
    async waitEvm(hash, timeoutMs = 120_000) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        const r = (await provider.request({ method: "eth_getTransactionReceipt", params: [hash] }).catch(() => null)) as { status?: string } | null;
        if (r?.status) return r.status === "0x1";
        await new Promise((res) => setTimeout(res, 2000));
      }
      throw new Error("Transaksi belum terkonfirmasi; cek di explorer");
    },
  };
}

// ------------------------------------------------------------------ Solana (Wallet Standard)
interface StdAccount {
  address: string;
  publicKey: Uint8Array;
}
interface StdWallet {
  name: string;
  icon: string;
  chains: readonly string[];
  features: Record<string, unknown>;
}
type ConnectFeature = { connect(): Promise<{ accounts: readonly StdAccount[] }> };
type SignAndSendFeature = {
  signAndSendTransaction(...inputs: { account: StdAccount; chain: string; transaction: Uint8Array }[]): Promise<{ signature: Uint8Array }[]>;
};
type SignMessageFeature = { signMessage(...inputs: { account: StdAccount; message: Uint8Array }[]): Promise<{ signature: Uint8Array }[]> };

function solanaOption(w: StdWallet): WalletOption | null {
  const connect = w.features["standard:connect"] as ConnectFeature | undefined;
  const signer = w.features["solana:signMessage"] as SignMessageFeature | undefined;
  if (!connect || !signer || !w.chains.some((c) => c.startsWith("solana:"))) return null;
  let account: StdAccount | null = null;
  return {
    id: `solana:${w.name}`,
    name: w.name,
    icon: safeIcon(w.icon),
    kind: "solana",
    async connect() {
      const { accounts } = await connect.connect();
      account = accounts[0] ?? null;
      if (!account) throw new Error("Wallet tidak memberi alamat");
      return { address: account.address };
    },
    async sign(message) {
      if (!account) throw new Error("Wallet belum terhubung");
      const [out] = await signer.signMessage({ account, message: new TextEncoder().encode(message) });
      return base58.encode(out.signature);
    },
    async sendSolana(txBase64) {
      const sender = w.features["solana:signAndSendTransaction"] as SignAndSendFeature | undefined;
      if (!sender) throw new Error(`${w.name} tidak mendukung pengiriman transaksi`);
      if (!account) throw new Error("Wallet belum terhubung");
      const bytes = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));
      const [out] = await sender.signAndSendTransaction({ account, chain: "solana:mainnet", transaction: bytes });
      return base58.encode(out.signature);
    },
  };
}

/** Daftar wallet terpasang. Wallet bisa mendaftar sedikit terlambat → onChange dipanggil lagi. */
export function discoverWallets(onChange: (list: WalletOption[]) => void): () => void {
  const evm = new Map<string, WalletOption>();
  const sol = new Map<string, WalletOption>();
  const emit = () => {
    const list = [...sol.values(), ...evm.values()];
    // fallback window.ethereum bila tidak ada yang mendukung EIP-6963
    const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (!evm.size && eth) list.push(evmOption("injected", "Browser wallet (EVM)", null, eth));
    onChange(list);
  };

  const onEvm = (e: Event) => {
    const d = (e as CustomEvent<Eip6963Detail>).detail;
    if (!d?.info?.uuid || !d.provider) return;
    evm.set(d.info.rdns || d.info.uuid, evmOption(d.info.rdns || d.info.uuid, String(d.info.name).slice(0, 40), safeIcon(d.info.icon), d.provider));
    emit();
  };
  const register = (...wallets: StdWallet[]) => {
    for (const w of wallets) {
      const o = solanaOption(w);
      if (o) sol.set(o.id, o);
    }
    emit();
    return () => {};
  };
  const onStd = (e: Event) => {
    const cb = (e as CustomEvent<(api: { register: typeof register }) => void>).detail;
    if (typeof cb === "function") cb({ register });
  };

  window.addEventListener("eip6963:announceProvider", onEvm);
  window.addEventListener("wallet-standard:register-wallet", onStd);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: { register } }));
  emit();
  return () => {
    window.removeEventListener("eip6963:announceProvider", onEvm);
    window.removeEventListener("wallet-standard:register-wallet", onStd);
  };
}
