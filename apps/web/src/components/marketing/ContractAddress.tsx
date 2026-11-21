"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { SiteToken } from "@/lib/data/api";

/** Chip contract address di hero: alamat lengkap bisa disalin, dipendekkan di layar sempit. */
export function ContractAddress({ token }: { token: SiteToken }) {
  const [copied, setCopied] = useState(false);
  const short = `${token.address.slice(0, 6)}…${token.address.slice(-6)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard diblokir: alamat tetap bisa diseleksi manual */
    }
  };
  return (
    <div className="mt-7 flex max-w-full flex-wrap items-center justify-center gap-2">
      <button
        onClick={copy}
        title="Copy contract address"
        className="group inline-flex max-w-full items-center gap-2.5 border border-gold/45 bg-black/45 px-3 py-2 text-left backdrop-blur-sm hover:border-gold/80"
      >
        <span className="font-roman text-[10px] tracking-[0.2em] whitespace-nowrap text-gold uppercase">{token.symbol ? `$${token.symbol} CA` : "CA"}</span>
        <span className="num truncate text-[12.5px] text-cream">
          <span className="hidden md:inline">{token.address}</span>
          <span className="md:hidden">{short}</span>
        </span>
        <span className="text-cream/70 group-hover:text-cream">{copied ? <Check size={14} className="text-up" /> : <Copy size={14} />}</span>
      </button>
      <span className="font-roman text-[10px] tracking-[0.18em] text-cream/60 uppercase">{token.chain}</span>
      {token.buyUrl && (
        <a href={token.buyUrl} target="_blank" rel="noopener noreferrer" className="font-roman text-[10px] tracking-[0.18em] text-gold uppercase underline-offset-4 hover:underline">
          Chart ↗
        </a>
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? "Contract address copied" : ""}
      </span>
    </div>
  );
}
