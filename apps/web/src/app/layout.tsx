import type { Metadata } from "next";
import { Cinzel, Cormorant_Garamond, Roboto, Space_Grotesk } from "next/font/google";
import { BRAND } from "@/config/brand";
import "./globals.css";

const roboto = Roboto({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-roboto" });
const geo = Space_Grotesk({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--font-geo" });
// Tema klasik (hero & logo): huruf kapital gaya prasasti Romawi + serif untuk judul.
const roman = Cinzel({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-cinzel" });
const serif = Cormorant_Garamond({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-cormorant" });

export const metadata: Metadata = {
  title: { default: `${BRAND.name} | ${BRAND.tagline}`, template: `%s | ${BRAND.name}` },
  description: "Real-time onchain intelligence: terminal, institutional analytics, research and data API in one place.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${roboto.variable} ${geo.variable} ${roman.variable} ${serif.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
