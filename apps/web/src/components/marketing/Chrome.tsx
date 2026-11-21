"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { SocialLinks } from "./SocialLinks";
import { BRAND, ROUTES } from "@/config/brand";

export function AnnouncementBar({ text, href }: { text: string; href: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="relative flex items-center justify-center bg-[#e9e9e9] px-10 py-1.5 font-mono text-[11px] tracking-wide text-black uppercase">
      <span className="truncate">{text}</span>
      <Link href={href} className="ml-2 shrink-0 underline">
        Learn more
      </Link>
      <button aria-label="Close announcement" onClick={() => setOpen(false)} className="absolute right-3 text-black/60 hover:text-black">
        <X size={14} />
      </button>
    </div>
  );
}

export interface NavItem {
  label: string;
  href?: string;
  children?: { label: string; href: string; desc?: string }[];
}

export const HUB_NAV: NavItem[] = [
  {
    label: "Products",
    children: [
      { label: BRAND.products.terminal, href: ROUTES.terminal, desc: "Go-to terminal for winning traders" },
      { label: BRAND.products.data, href: ROUTES.dataApi, desc: "Decision-grade onchain data API" },
      { label: BRAND.products.peak, href: ROUTES.peak, desc: "Unified institutional terminal" },
      { label: "MCP Server", href: ROUTES.mcp, desc: "Live onchain data for Claude, Cursor and other agents" },
    ],
  },
  { label: "Analyst", href: ROUTES.agent },
  { label: "Research & Insights", href: ROUTES.research },
  {
    label: "Company",
    children: [
      { label: "About Us", href: ROUTES.about },
      { label: "Careers", href: ROUTES.careers },
      { label: "Contact", href: `${ROUTES.dataApi}#contact` },
    ],
  },
  { label: "Blog", href: ROUTES.blog },
];

export function MarketingNav({
  items = HUB_NAV,
  cta = { label: "Start Building", href: ROUTES.dataApi },
  secondary,
  logoHref = "/",
  logoSub = "Crypto intelligence",
}: {
  items?: NavItem[];
  cta?: { label: string; href: string };
  secondary?: { label: string; href: string };
  logoHref?: string;
  logoSub?: string;
}) {
  const [mobile, setMobile] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-ink/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-4 md:px-8">
        <Logo href={logoHref} sub={logoSub} />
        <nav className="hidden flex-1 items-center gap-1 lg:flex">
          {items.map((it) =>
            it.children ? (
              <div key={it.label} className="group relative">
                <button className="flex items-center gap-1 rounded-md px-3 py-2 text-[15px] text-fg/90 hover:text-fg">
                  {it.label} <ChevronDown size={14} className="transition group-hover:rotate-180" />
                </button>
                <div className="invisible absolute top-full left-0 min-w-64 pt-2 opacity-0 transition group-hover:visible group-hover:opacity-100">
                  <div className="rounded-xl border border-white/10 bg-panel p-2 shadow-2xl">
                    {it.children.map((c) => (
                      <Link key={c.label} href={c.href} className="block rounded-lg px-3 py-2.5 hover:bg-white/5">
                        <div className="text-sm text-fg">{c.label}</div>
                        {c.desc && <div className="text-xs text-dim">{c.desc}</div>}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <Link key={it.label} href={it.href!} className="rounded-md px-3 py-2 text-[15px] text-fg/90 hover:text-fg">
                {it.label}
              </Link>
            ),
          )}
        </nav>
        <div className="ml-auto hidden items-center gap-3 lg:flex">
          <SocialLinks />
          {secondary && (
            <Link href={secondary.href} className="rounded-md bg-[#e8c9a6] px-4 py-2 text-sm font-medium text-black hover:brightness-105">
              {secondary.label}
            </Link>
          )}
          <Link href={cta.href} className="rounded-md bg-white px-4 py-2 text-[15px] font-medium text-black hover:bg-white/90">
            {cta.label}
          </Link>
        </div>
        <button className="ml-auto text-fg lg:hidden" aria-label="Open menu" onClick={() => setMobile((v) => !v)}>
          {mobile ? <X /> : <Menu />}
        </button>
      </div>
      {mobile && (
        <div className="border-t border-white/10 bg-ink px-4 py-4 lg:hidden">
          {items.map((it) => (
            <div key={it.label} className="py-1">
              {it.href ? (
                <Link href={it.href} className="block py-2 text-fg" onClick={() => setMobile(false)}>
                  {it.label}
                </Link>
              ) : (
                <>
                  <div className="py-2 text-xs tracking-wider text-dim uppercase">{it.label}</div>
                  {it.children?.map((c) => (
                    <Link key={c.label} href={c.href} className="block py-2 pl-3 text-fg" onClick={() => setMobile(false)}>
                      {c.label}
                    </Link>
                  ))}
                </>
              )}
            </div>
          ))}
          <Link href={cta.href} className="mt-3 block rounded-md bg-white px-4 py-2.5 text-center font-medium text-black">
            {cta.label}
          </Link>
        </div>
      )}
    </header>
  );
}

export function MarketingFooter() {
  const cols = [
    { title: "Products", links: [[BRAND.products.terminal, ROUTES.terminal], [BRAND.products.data, ROUTES.dataApi], [BRAND.products.peak, ROUTES.peak]] },
    { title: "Company", links: [["About Us", ROUTES.about], ["Careers", ROUTES.careers], ["Contact", `${ROUTES.dataApi}#contact`]] },
    { title: "Research", links: [["Research", ROUTES.research], ["Reports", "/research/category/flagship-reports"], ["Blog", ROUTES.blog]] },
  ];
  return (
    <footer className="border-t border-white/10 bg-ink">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-[1.5fr_repeat(3,1fr)] md:px-8">
        <div>
          <Logo sub="Crypto intelligence" />
          <p className="mt-4 max-w-xs text-sm text-dim">{BRAND.tagline}.</p>
          <SocialLinks className="mt-6 -ml-2" />
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <div className="mb-4 text-sm font-medium text-fg">{c.title}</div>
            <ul className="space-y-2.5 text-sm text-dim">
              {c.links.map(([l, h]) => (
                <li key={l}>
                  <Link href={h} className="hover:text-fg">
                    {l}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/5 py-5 text-center text-xs text-muted">
        © {2026} {BRAND.name}. All rights reserved.
        <span className="mx-2">·</span>
        <Link href="/privacy" className="hover:text-fg">
          Privacy
        </Link>
        <span className="mx-2">·</span>
        <Link href="/terms" className="hover:text-fg">
          Terms
        </Link>
        <div className="mt-1 text-[11px] text-dim">{BRAND.disclaimer}</div>
      </div>
    </footer>
  );
}

export function Marquee({ children, slow }: { children: React.ReactNode; slow?: boolean }) {
  return (
    <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
      <div className={`flex w-max gap-6 ${slow ? "[animation-duration:70s]" : ""} animate-marquee hover:[animation-play-state:paused]`}>
        {children}
        {children}
      </div>
    </div>
  );
}

export function SectionHeading({ eyebrow, title, desc, center }: { eyebrow?: string; title: string; desc?: string; center?: boolean }) {
  return (
    <div className={center ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      {eyebrow && <div className="mb-3 text-sm tracking-wider text-primary uppercase">{eyebrow}</div>}
      <h2 className="font-display text-3xl font-light tracking-tight text-fg md:text-5xl">{title}</h2>
      {desc && <p className="mt-4 text-base text-dim md:text-lg">{desc}</p>}
    </div>
  );
}
