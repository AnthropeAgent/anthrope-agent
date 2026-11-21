import { PeakAppShell } from "./PeakAppShell";

export const metadata = { title: "Peak Terminal" };

/** Fase 3: lindungi route ini dengan middleware auth (wajib login). */
export default function PeakAppLayout({ children }: { children: React.ReactNode }) {
  return <PeakAppShell>{children}</PeakAppShell>;
}
