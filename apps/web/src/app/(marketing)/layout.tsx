import { AnnouncementBar, MarketingFooter, MarketingNav } from "@/components/marketing/Chrome";
import { BRAND } from "@/config/brand";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-ink text-dim">
      <AnnouncementBar text={`New: the ${BRAND.name} MCP server brings live onchain data to Claude and Cursor.`} href="/mcp" />
      <MarketingNav />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}
