"use client";

import { useState } from "react";

const TABS = [
  { k: "Peak AI", t: "AI trained for digital asset finance", d: "Boost research workflows with an assistant grounded in Peak data and analyst domain expertise.", demo: "> Summarize unlock risk for my watchlist next 30 days" },
  { k: "Command", t: "Command interface", d: "Reach every data point instantly with a keyboard-driven command bar. No clicking required.", demo: "⌘K  SOL <GO> FA  ·  UNLOCKS  ·  HOLDERS" },
  { k: "Workflow Utilities", t: "Workflow utilities", d: "Watchlists, saved views, an event calendar, and export to spreadsheet keep research velocity high.", demo: "Watchlist · Saved views · Calendar · Export CSV" },
];

export function PeakTabs() {
  const [i, setI] = useState(0);
  const tab = TABS[i];
  return (
    <div>
      <div className="flex flex-wrap justify-center gap-2">
        {TABS.map((x, j) => (
          <button key={x.k} onClick={() => setI(j)} className={`rounded-full px-5 py-2 text-sm ${i === j ? "bg-[#e8c9a6] text-black" : "border border-white/15 text-fg/80 hover:text-fg"}`}>
            {x.k}
          </button>
        ))}
      </div>
      <div className="mt-10 grid items-center gap-10 md:grid-cols-2">
        <div>
          <h3 className="font-display text-3xl font-light text-fg">{tab.t}</h3>
          <p className="mt-4 text-lg">{tab.d}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-panel p-6 font-mono text-sm text-[#e8c9a6]">
          <div className="mb-4 flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          </div>
          {tab.demo}
          <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-[#e8c9a6] align-middle" />
        </div>
      </div>
    </div>
  );
}
