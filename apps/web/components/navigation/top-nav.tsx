"use client";

import Link from "next/link";
import { useAuthStore } from "@/lib/store/use-auth-store";
import { Button } from "@/components/ui/button";
import { Search, Bell, Menu, LogOut, BriefcaseBusiness } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { SessionSwitcher } from "@/components/auth/session-switcher";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export function TopNav({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const { isLoggedIn, logout, login, role, user } = useAuthStore();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-4 px-4 md:px-8">
        <div className="flex items-center gap-4">
          <button
            onClick={onOpenSidebar}
            className="inline-flex items-center justify-center rounded-full border border-border/70 bg-card/70 p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground md:hidden"
          >
            <Menu className="h-6 w-6" />
          </button>
          
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-xs font-bold tracking-[0.28em] text-primary-foreground shadow-lg shadow-primary/20">
              LN
            </span>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Lance
              </p>
              <p className="text-base font-semibold text-foreground">
                {isLoggedIn ? `${role} workspace` : "Public network"}
              </p>
            </div>
          </Link>

          <nav className="ml-4 hidden items-center gap-3 xl:flex">
            <Link 
              href="/jobs" 
              className="rounded-full border border-transparent px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-border hover:bg-card/80 hover:text-foreground"
            >
              Browse Jobs
            </Link>
            <Link 
              href="/jobs/new" 
              className="rounded-full border border-transparent px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-border hover:bg-card/80 hover:text-foreground"
            >
              Post a Job
            </Link>
          </nav>
        </div>

        <div className="hidden flex-1 items-center justify-center px-4 lg:flex">
          <div className="relative w-full max-w-xl">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search jobs, talents..."
              className="glass-surface pl-9"
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <SessionSwitcher />
          <ThemeToggle />
          {isLoggedIn ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="relative rounded-full bg-card/70">
                <Bell className="h-5 w-5" />
                <span className="absolute top-2 right-2 flex h-2 w-2 rounded-full bg-primary"></span>
              </Button>
              <div className="hidden items-center gap-3 rounded-full border border-border/70 bg-card/70 px-2 py-1.5 md:flex">
                <Avatar className="h-8 w-8 border border-border/50">
                  <AvatarFallback className="bg-primary/15 text-xs font-semibold text-primary">
                    {user?.name
                      ?.split(" ")
                      .map((part) => part[0])
                      .join("")
                      .slice(0, 2) ?? "LN"}
                  </AvatarFallback>
                </Avatar>
                <div className="pr-2">
                  <p className="text-sm font-medium text-foreground">{user?.name}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => logout()} className="rounded-full">
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  login({ name: "Amaka Client", email: "client@lance.so" }, "client")
                }
                className="rounded-full"
              >
                Client Log In
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  login(
                    { name: "Kehinde Freelancer", email: "freelancer@lance.so" },
                    "freelancer",
                  )
                }
                className="rounded-full"
              >
                <BriefcaseBusiness className="mr-2 h-4 w-4" />
                Freelancer Sign Up
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
