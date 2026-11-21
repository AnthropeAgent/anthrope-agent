import { AdminArticles } from "@/components/admin/AdminArticles";
import { AdminSiteToken } from "@/components/admin/AdminSiteToken";

export const metadata = { title: "Admin", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <div className="min-h-dvh bg-bg">
      <AdminSiteToken />
      <AdminArticles />
    </div>
  );
}
