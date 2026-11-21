"use client";

import { useState } from "react";

/** Form leads (contact sales / commission report). Fase 3: POST ke /api/v1/leads. */
export function ContactForm({ fields = ["Full name", "Job title", "Work email", "Company name", "Company website"], withType = true }: { fields?: string[]; withType?: boolean }) {
  const [sent, setSent] = useState(false);
  if (sent)
    return <div className="rounded-2xl border border-up/40 bg-up/5 p-8 text-fg">Thanks! Our team will reach out shortly. (Demo: belum terhubung ke backend.)</div>;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setSent(true);
      }}
      className="grid gap-4 rounded-2xl border border-white/10 bg-panel p-6 md:grid-cols-2"
    >
      {fields.map((f) => (
        <label key={f} className="text-sm">
          <span className="text-fg">
            {f} <span className="text-down">*</span>
          </span>
          <input required type={f.includes("email") ? "email" : "text"} className="mt-1.5 w-full rounded-md border border-white/10 bg-bg px-3 py-2.5 text-fg outline-none focus:border-white/40" />
        </label>
      ))}
      {withType && (
        <label className="text-sm">
          <span className="text-fg">
            Company type <span className="text-down">*</span>
          </span>
          <select required defaultValue="" className="mt-1.5 w-full rounded-md border border-white/10 bg-bg px-3 py-2.5 text-fg outline-none">
            <option value="" disabled>
              Select
            </option>
            {["Prop trading", "Venture capital", "Asset manager", "Fintech", "Investment bank", "Family office", "Other"].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
      )}
      <label className="text-sm md:col-span-2">
        <span className="text-fg">What are you trying to solve? (optional)</span>
        <textarea rows={4} className="mt-1.5 w-full rounded-md border border-white/10 bg-bg px-3 py-2.5 text-fg outline-none focus:border-white/40" />
      </label>
      <button className="rounded-md bg-white px-5 py-3 font-medium text-black md:col-span-2 md:justify-self-start">Submit</button>
    </form>
  );
}
