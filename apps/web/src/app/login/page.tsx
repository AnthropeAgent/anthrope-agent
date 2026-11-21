import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/Logo";
import { LoginPanel } from "@/components/account/LoginPanel";

export const metadata = { title: "Log in" };

/** Satu halaman login untuk semua produk (satu domain = satu sesi). Langkah 5: SIWS/SIWE. */
export default function LoginPage() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-8">
        <Logo />
        <h1 className="mt-8 text-xl text-fg">Log in</h1>
        <p className="mt-1 text-sm text-muted">One account for Terminal, Peak, Research and Data API.</p>
        <Suspense>
          <LoginPanel />
        </Suspense>
        <Link href="/terminal" className="mt-6 block text-center text-sm text-muted hover:text-fg">
          ← Back to Terminal
        </Link>
      </div>
    </div>
  );
}
