/**
 * Sign-In With Solana / Ethereum (ARCHITECTURE §4.13, format pesan EIP-4361).
 *
 * Server yang menyusun pesan (domain, URI, chain ID, nonce, waktu) dan menyimpannya bersama nonce;
 * saat verify, pesan dari client harus SAMA PERSIS dengan yang disimpan. Jadi domain/chain/nonce
 * tidak perlu di-parse ulang dan tidak bisa diganti client.
 *
 * Verifikasi tanda tangan:
 * - Solana: ed25519 atas byte UTF-8 pesan, public key = alamat (base58).
 * - EVM: personal_sign (EIP-191) → recover secp256k1 → alamat. Wallet smart contract (EIP-1271) belum didukung.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { base58 } from "@scure/base";
import type { ChainKind } from "@ot/types";

export const NONCE_TTL_SEC = 300;

const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

export function isWalletAddress(kind: ChainKind, address: string): boolean {
  if (kind === "evm") return EVM_RE.test(address);
  if (!SOLANA_RE.test(address)) return false;
  try {
    return base58.decode(address).length === 32;
  } catch {
    return false;
  }
}

/** Alamat EVM checksum EIP-55 (wajib di pesan EIP-4361). */
export function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, "");
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = "0x";
  for (let i = 0; i < lower.length; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  return out;
}

/** Bentuk penyimpanan alamat: EVM lowercase, Solana apa adanya (base58 case-sensitive). */
export const normWallet = (kind: ChainKind, address: string) => (kind === "evm" ? address.toLowerCase() : address);

export interface SiwxInput {
  kind: ChainKind;
  address: string;
  domain: string; // host, mis. "localhost:3000"
  uri: string; // origin, mis. "http://localhost:3000"
  appName: string;
  nonce: string;
  evmChainId?: number;
  issuedAt: Date;
}

export function buildMessage(i: SiwxInput): string {
  const account = i.kind === "evm" ? "Ethereum" : "Solana";
  const address = i.kind === "evm" ? toChecksumAddress(i.address) : i.address;
  const expires = new Date(i.issuedAt.getTime() + NONCE_TTL_SEC * 1000);
  return [
    `${i.domain} wants you to sign in with your ${account} account:`,
    address,
    "",
    `Sign in to ${i.appName}. This request will not trigger a blockchain transaction or cost any fees.`,
    "",
    `URI: ${i.uri}`,
    "Version: 1",
    `Chain ID: ${i.kind === "evm" ? (i.evmChainId ?? 1) : "mainnet"}`,
    `Nonce: ${i.nonce}`,
    `Issued At: ${i.issuedAt.toISOString()}`,
    `Expiration Time: ${expires.toISOString()}`,
  ].join("\n");
}

/** Nonce dari pesan (untuk mencari pesan tersimpan); null bila tidak ada/format salah. */
export function nonceOf(message: string): string | null {
  return /\nNonce: ([0-9a-f]{32})\n/.exec(message)?.[1] ?? null;
}

export function verifySolana(address: string, message: string, signatureB58: string): boolean {
  try {
    const sig = base58.decode(signatureB58);
    const pub = base58.decode(address);
    if (sig.length !== 64 || pub.length !== 32) return false;
    return ed25519.verify(sig, utf8ToBytes(message), pub);
  } catch {
    return false;
  }
}

/** Alamat EVM (lowercase) yang menandatangani `message` lewat personal_sign, atau null. */
export function recoverEvm(message: string, signatureHex: string): string | null {
  try {
    if (!/^0x[0-9a-fA-F]{130}$/.test(signatureHex)) return null;
    const bytes = hexToBytes(signatureHex.slice(2));
    const v = bytes[64];
    const recovery = v >= 27 ? v - 27 : v;
    if (recovery !== 0 && recovery !== 1) return null;
    const msg = utf8ToBytes(message);
    const hash = keccak_256(new Uint8Array([...utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`), ...msg]));
    const pub = secp256k1.Signature.fromCompact(bytes.slice(0, 64)).addRecoveryBit(recovery).recoverPublicKey(hash).toRawBytes(false);
    return "0x" + bytesToHex(keccak_256(pub.slice(1)).slice(-20));
  } catch {
    return null;
  }
}

export function verifySignature(kind: ChainKind, address: string, message: string, signature: string): boolean {
  if (kind === "solana") return verifySolana(address, message, signature);
  return recoverEvm(message, signature) === address.toLowerCase();
}
