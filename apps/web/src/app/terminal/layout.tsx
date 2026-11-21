import { TerminalShell } from "@/components/terminal/TerminalShell";

export const metadata = { title: { default: "Terminal", template: "%s | Terminal" } };

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return <TerminalShell>{children}</TerminalShell>;
}
