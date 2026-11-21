"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { ROUTES } from "@/config/brand";
import { chainById } from "@/config/chains";
import type { SearchResult } from "@/lib/data/api";
import { dataProvider } from "@/lib/data/provider";
import type { Token } from "@/lib/data/types";
import { fmtPrice, fmtUsd, shortAddr } from "@/lib/format";
import { TokenAvatar } from "./TokenAvatar";

const DEBOUNCE_MS = 150;
/** Alamat yang belum di-cache diambil worker (±30 dtk); cari ulang berkala selama itu. */
const PENDING_RETRY_MS = 5000;
const PENDING_MAX_TRIES = 12;
const ADDRESS_RE = /^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

const EMPTY: SearchResult = { tokens: [], pending: [] };

type Item = { kind: "token"; token: Token } | { kind: "wallet"; address: string };

/**
 * Search global (token, alamat, wallet). Dipakai di hero hub dan topbar terminal.
 * Shortcut "/" atau Ctrl/Cmd+K untuk fokus; ↑/↓ memilih, Enter membuka, Esc menutup.
 */
export function SearchBox({ variant = "terminal", placeholder = "Search..." }: { variant?: "hero" | "terminal"; placeholder?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResult>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input,textarea,[contenteditable]");
      if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setRes(EMPTY);
      setLoading(false);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    const run = async () => {
      const r = await dataProvider.search(query);
      if (!alive) return;
      setRes(r);
      setActive(0);
      setLoading(false);
      // Alamat baru: worker sedang mengambilnya → cari ulang sampai muncul (atau menyerah).
      if (r.pending.length && !r.tokens.length && ++tries < PENDING_MAX_TRIES) timer = setTimeout(run, PENDING_RETRY_MS);
    };
    setLoading(true);
    timer = setTimeout(run, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);

  const query = q.trim();
  const isAddress = ADDRESS_RE.test(query);
  const pending = res.pending.length > 0 && res.tokens.length === 0;
  const items: Item[] = [
    ...res.tokens.map((token): Item => ({ kind: "token", token })),
    ...(isAddress && res.tokens.length === 0 ? [{ kind: "wallet" as const, address: query }] : []),
  ];

  const close = () => {
    setOpen(false);
    setQ("");
  };
  const choose = (it: Item) => {
    close();
    router.push(it.kind === "token" ? ROUTES.token(it.token.chain, it.token.address) : ROUTES.wallet(it.address));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      setOpen(true);
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
    } else if (e.key === "Enter" && items[active]) {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      ref.current?.blur();
    }
  };

  const hero = variant === "hero";
  const showPanel = open && query.length > 0 && (items.length > 0 || pending || !loading);
  const pendingChains = res.pending.map((p) => chainById(p.chain)?.name ?? p.chain).join(" / ");

  return (
    <div className="relative w-full">
      <div
        className={
          hero
            ? "flex h-12 items-center gap-3 rounded-md border border-white/20 bg-white/90 px-4 text-black"
            : "flex h-9 items-center gap-2 rounded-md border border-primary/70 bg-panel px-3 text-soft focus-within:border-primary"
        }
      >
        {loading ? (
          <Loader2 size={hero ? 18 : 16} className={`animate-spin ${hero ? "text-black/50" : "text-muted"}`} />
        ) : (
          <Search size={hero ? 18 : 16} className={hero ? "text-black/50" : "text-muted"} />
        )}
        <input
          ref={ref}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          maxLength={100}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="search-results"
          aria-autocomplete="list"
          className={`min-w-0 flex-1 bg-transparent outline-none ${hero ? "placeholder:text-black/50" : "text-sm placeholder:text-muted"}`}
        />
        {!hero && <kbd className="grid h-5 w-5 place-items-center rounded bg-primary text-[11px] text-ink">/</kbd>}
      </div>
      {showPanel && (
        <div
          id="search-results"
          role="listbox"
          className="absolute top-full right-0 left-0 z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-line-2 bg-panel text-left shadow-2xl"
        >
          {pending && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted">
              <Loader2 size={13} className="animate-spin" /> Mengambil data token di {pendingChains}…
            </div>
          )}
          {res.tokens.length > 0 && <div className="px-3 pt-2 pb-1 text-[11px] tracking-wider text-muted uppercase">Tokens</div>}
          {items.map((it, i) =>
            it.kind === "token" ? (
              <button
                key={it.token.chain + it.token.address}
                role="option"
                aria-selected={i === active}
                onMouseDown={() => choose(it)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 px-3 py-2 ${i === active ? "bg-panel-3" : ""}`}
              >
                <TokenAvatar symbol={it.token.symbol} color={it.token.logoColor} logoUrl={it.token.logoUrl} chain={it.token.chain} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-fg">
                    {it.token.symbol} <span className="text-muted">{it.token.name}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {chainById(it.token.chain)?.name ?? it.token.chain} · {shortAddr(it.token.address)} · Liq {fmtUsd(it.token.liquidity)}
                  </div>
                </div>
                <div className="num text-right text-xs">
                  <div className="text-fg">{fmtPrice(it.token.price)}</div>
                  <div className="text-muted">MC {fmtUsd(it.token.marketCap)}</div>
                </div>
              </button>
            ) : (
              <button
                key="wallet"
                role="option"
                aria-selected={i === active}
                onMouseDown={() => choose(it)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-sm text-soft ${i === active ? "bg-panel-3" : ""}`}
              >
                Open wallet <span className="text-muted">{shortAddr(it.address, 6, 6)}</span>
              </button>
            ),
          )}
          {!items.length && !pending && !loading && <div className="px-3 py-3 text-sm text-muted">Tidak ada token yang cocok dengan “{query}”.</div>}
        </div>
      )}
    </div>
  );
}
