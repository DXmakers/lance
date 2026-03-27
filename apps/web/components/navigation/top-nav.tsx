"use client";

import Link from "next/link";
import { useAuthStore } from "@/lib/store/use-auth-store";
import { Button } from "@/components/ui/button";
import { Search, Bell, Menu, User, LogOut } from "lucide-react";

export function TopNav({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const { isLoggedIn, logout, login } = useAuthStore();

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="container flex h-16 items-center justify-between px-4 md:px-8">
        <div className="flex items-center gap-4">
          <button
            onClick={onOpenSidebar}
            className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground md:hidden"
          >
            <Menu className="h-6 w-6" />
          </button>
          
          <Link href="/" className="flex items-center space-x-2">
            <span className="text-xl font-bold tracking-tighter text-primary">LANCE</span>
          </Link>

          <nav className="ml-8 hidden md:flex items-center gap-6">
            <Link 
              href="/jobs" 
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              Browse Jobs
            </Link>
            <Link 
              href="/freelancers" 
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              Find Talent
            </Link>
          </nav>
        </div>

        <div className="flex flex-1 items-center justify-center px-4 md:max-w-md lg:max-w-lg">
          <div className="relative w-full max-w-sm hidden sm:block">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search jobs, talents..."
              className="w-full rounded-full border border-input bg-background pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          {isLoggedIn ? (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                <span className="absolute top-2 right-2 flex h-2 w-2 rounded-full bg-primary"></span>
              </Button>
              <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center">
                <User className="h-5 w-5" />
              </div>
              <Button variant="ghost" size="sm" onClick={() => logout()}>
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => login("Guest Client", "guest@example.com", "client")}>
                Client Log In
              </Button>
              <Button size="sm" onClick={() => login("Guest Freelancer", "guest@example.com", "freelancer")}>
                Freelancer Sign Up
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
