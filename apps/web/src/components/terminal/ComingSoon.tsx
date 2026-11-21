import Link from "next/link";
import { ROUTES } from "@/config/brand";

export function ComingSoon({ title, desc, phase = "Fase 3" }: { title: string; desc: string; phase?: string }) {
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div className="max-w-md">
        <div className="text-xs tracking-widest text-primary uppercase">{phase}</div>
        <h1 className="mt-2 text-2xl font-bold text-fg">{title}</h1>
        <p className="mt-2 text-sm text-muted">{desc}</p>
        <Link href={ROUTES.terminal} className="mt-6 inline-block rounded-md bg-primary px-5 py-2 text-sm font-bold text-ink">
          Back to Discover
        </Link>
      </div>
    </div>
  );
}
