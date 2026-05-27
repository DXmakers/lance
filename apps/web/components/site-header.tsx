"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X, ArrowRight, Gavel, Award, Briefcase, LayoutDashboard } from "lucide-react";
import { WalletConnect } from "@/components/wallet-connect";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Gigs & Jobs", href: "/jobs", icon: Briefcase },
    { name: "Milestones", href: "/milestones", icon: Award },
    { name: "Disputes", href: "/disputes", icon: Gavel },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-800/40 bg-zinc-950/70 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo Brand */}
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="relative h-9 w-9 overflow-hidden rounded-lg bg-zinc-900 border border-zinc-800 p-1 flex items-center justify-center transition-all duration-300 group-hover:border-primary/50 group-hover:shadow-[0_0_12px_rgba(226,154,47,0.2)]">
                <Image 
                  src="/favicon.png" 
                  alt="Lance Logo" 
                  width={28} 
                  height={28} 
                  className="object-contain"
                />
              </div>
              <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-zinc-50 via-zinc-100 to-zinc-400 bg-clip-text text-transparent group-hover:to-primary/95 transition-all">
                LANCE
              </span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-1">
              {navigation.map((item) => {
                const isActive = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 hover:text-zinc-50 hover:bg-zinc-900/60",
                      isActive 
                        ? "text-zinc-50 bg-zinc-900 border border-zinc-800/80 shadow-[0_2px_10px_-4px_rgba(226,154,47,0.15)]" 
                        : "text-zinc-400"
                    )}
                  >
                    <Icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-zinc-500")} />
                    {item.name}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right Action Menu */}
          <div className="hidden md:flex items-center gap-4">
            <Link
              href="/jobs/new"
              className="inline-flex items-center justify-center gap-1.5 rounded-full bg-zinc-900 border border-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100 hover:border-zinc-700"
            >
              Post Job
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <div className="h-6 w-[1px] bg-zinc-800/60" />
            <WalletConnect />
          </div>

          {/* Mobile menu button */}
          <div className="flex md:hidden items-center gap-2">
            <WalletConnect />
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="inline-flex items-center justify-center rounded-lg p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 focus:outline-none border border-zinc-900"
              aria-expanded={isOpen}
            >
              {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden border-b border-zinc-800/40 bg-zinc-950/95 animate-in fade-in-50 slide-in-from-top-5 duration-200">
          <div className="space-y-1 px-4 pb-4 pt-2">
            {navigation.map((item) => {
              const isActive = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium transition-all",
                    isActive 
                      ? "text-zinc-50 bg-zinc-900 border border-zinc-800/80" 
                      : "text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-100"
                  )}
                >
                  <Icon className={cn("h-5 w-5", isActive ? "text-primary" : "text-zinc-500")} />
                  {item.name}
                </Link>
              );
            })}
            <div className="pt-4 border-t border-zinc-900 mt-4 px-2">
              <Link
                href="/jobs/new"
                onClick={() => setIsOpen(false)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-center text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
              >
                Launch Brief
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
