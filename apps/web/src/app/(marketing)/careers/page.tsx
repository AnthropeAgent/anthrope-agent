import { SectionHeading } from "@/components/marketing/Chrome";

export const metadata = { title: "Careers" };

const JOBS = [
  ["Senior Backend Engineer (Indexing)", "Engineering", "Remote"],
  ["Frontend Engineer (Trading UI)", "Engineering", "Remote"],
  ["Research Analyst", "Research", "Remote"],
  ["Business Development", "Growth", "Singapore"],
];

export default function CareersPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-20 md:px-8">
      <SectionHeading eyebrow="Careers" title="Build the data layer of onchain markets" />
      <div className="mt-12 divide-y divide-white/10 rounded-2xl border border-white/10">
        {JOBS.map(([t, d, l]) => (
          <div key={t} className="flex flex-col gap-1 px-6 py-5 md:flex-row md:items-center">
            <span className="flex-1 text-fg">{t}</span>
            <span className="text-sm md:w-40">{d}</span>
            <span className="text-sm md:w-32">{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
