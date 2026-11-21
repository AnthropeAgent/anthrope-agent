import { SectionHeading } from "@/components/marketing/Chrome";
import { BRAND } from "@/config/brand";

export const metadata = { title: "About Us" };

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-20 md:px-8">
      <SectionHeading eyebrow="About" title={`We are ${BRAND.name}`} desc="Ganti dengan cerita perusahaanmu: misi, tim, investor, dan milestone." />
      <div className="mt-14 grid gap-4 md:grid-cols-3">
        {["Mission", "Team", "Backed by"].map((t) => (
          <div key={t} className="h-48 rounded-2xl border border-white/10 p-6 text-fg">
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}
