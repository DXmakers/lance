import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { Rocket, LayoutDashboard, Briefcase, PlusCircle } from "lucide-react";
import { ToastProvider } from "@/components/ui/toast-provider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Lance - Decentralized Freelance Marketplace",
  description: "Stellar-native freelance marketplace with AI-powered dispute resolution",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased text-foreground bg-background`}>
        <nav className="fixed top-0 left-0 right-0 z-50 glass">
            <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                <Link href="/" className="flex items-center gap-2 group">
                    <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center group-hover:rotate-12 transition-transform shadow-lg shadow-primary/30">
                        <Rocket className="text-white" size={20} />
                    </div>
                    <span className="text-2xl font-black tracking-tighter">LANCE</span>
                </Link>

                <div className="flex items-center gap-8">
                    <Link href="/jobs" className="flex items-center gap-2 text-sm font-bold opacity-60 hover:opacity-100 transition-opacity">
                        <Briefcase size={18} />
                        Jobs
                    </Link>
                    <Link href="/dashboard" className="flex items-center gap-2 text-sm font-bold opacity-60 hover:opacity-100 transition-opacity">
                        <LayoutDashboard size={18} />
                        Dashboard
                    </Link>
                    <Link href="/jobs/new" className="flex items-center gap-2 bg-primary hover:bg-primary/80 px-4 py-2 rounded-xl text-sm font-bold shadow-lg shadow-primary/20 transition-all">
                        <PlusCircle size={18} />
                        Post a Job
                    </Link>
                </div>
            </div>
        </nav>
        <div className="pt-24 min-h-screen">
          {children}
        </div>
        <footer className="border-t border-border p-12 text-center text-muted-foreground text-sm">
            © 2026 Lance Foundation. Powered by Soroban.
        </footer>
      </body>
    </html>
  );
}
