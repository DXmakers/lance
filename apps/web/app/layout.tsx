import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lance | Stellar Freelance Infrastructure",
  description: "Premium freelance execution with escrow, verifiable reputation, and transparent AI arbitration.",
  icons: {
    icon: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans antialiased bg-zinc-950 text-zinc-50`}>
        <Providers>
          <div className="flex flex-col min-h-screen">
            <SiteHeader />
            <main className="flex-1 mx-auto max-w-7xl w-full p-4 md:p-8">
              {children}
            </main>
            <SiteFooter />
          </div>
          <Toaster position="top-right" expand={false} richColors />
        </Providers>
      </body>
    </html>
  );
}

