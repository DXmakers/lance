"use client";

import Link from "next/link";
import { useAuthStore } from "@/lib/store/use-auth-store";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  Briefcase, 
  MessageSquare, 
  FileText, 
  Settings, 
  PlusCircle, 
  Users, 
  Zap, 
  ShieldCheck, 
  Home,
  TrendingUp,
  BarChart2,
  Search as SearchIcon
} from "lucide-react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";


interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
}

function NavItem({ href, icon, label }: NavItemProps) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all group",
        isActive 
          ? "bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20" 
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <div className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg transition-all",
        isActive ? "bg-primary text-primary-foreground" : "bg-muted group-hover:bg-accent-foreground/5"
      )}>
        {icon}
      </div>
      <span className="flex-1">{label}</span>
      {isActive && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
    </Link>
  );
}

const DASHBOARD_LINKS: Record<string, NavItemProps[]> = {
  client: [
    { href: "/dashboard", icon: <LayoutDashboard className="h-4 w-4" />, label: "Dashboard" },
    { href: "/post-job", icon: <PlusCircle className="h-4 w-4" />, label: "Post a Job" },
    { href: "/active-jobs", icon: <Briefcase className="h-4 w-4" />, label: "My Jobs" },
    { href: "/talent", icon: <Users className="h-4 w-4" />, label: "Find Talent" },
    { href: "/messages", icon: <MessageSquare className="h-4 w-4" />, label: "Messages" },
    { href: "/analytics", icon: <BarChart2 className="h-4 w-4" />, label: "Analytics" },
    { href: "/settings", icon: <Settings className="h-4 w-4" />, label: "Settings" },
  ],
  freelancer: [
    { href: "/dashboard", icon: <LayoutDashboard className="h-4 w-4" />, label: "Dashboard" },
    { href: "/find-work", icon: <SearchIcon className="h-4 w-4" />, label: "Find Work" },
    { href: "/my-contracts", icon: <FileText className="h-4 w-4" />, label: "My Contracts" },
    { href: "/proposals", icon: <TrendingUp className="h-4 w-4" />, label: "Proposals" },
    { href: "/messages", icon: <MessageSquare className="h-4 w-4" />, label: "Messages" },
    { href: "/settings", icon: <Settings className="h-4 w-4" />, label: "Settings" },
  ],
  'logged-out': [
    { href: "/", icon: <Home className="h-4 w-4" />, label: "Home" },
    { href: "/explore", icon: <Zap className="h-4 w-4" />, label: "Explore Lance" },
    { href: "/trust", icon: <ShieldCheck className="h-4 w-4" />, label: "Trust & Safety" },
  ],
};



export function Sidebar({ className }: { className?: string }) {
  const { role, isLoggedIn } = useAuthStore();
  const links = DASHBOARD_LINKS[role] || DASHBOARD_LINKS['logged-out'];

  return (
    <aside className={cn("hidden h-[calc(100vh-4rem)] w-64 flex-col border-r bg-card/10 px-4 py-8 md:flex glass-sidebar", className)}>
      <div className="flex flex-col gap-2">
        <p className="px-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-2">
          {isLoggedIn ? "Navigation" : "General"}
        </p>
        <div className="flex flex-col gap-1.5">
          {links.map((link) => (
            <NavItem key={link.href} {...link} />
          ))}
        </div>
      </div>

      <div className="mt-auto p-4 rounded-2xl bg-primary/5 border border-primary/10">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
            <Zap className="h-4 w-4 text-primary" />
          </div>
          <span className="text-sm font-semibold">Lance Pro</span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed mb-4">
          Enable Soroban-powered instant settlements and cross-border payments.
        </p>
        <Button size="sm" variant="default" className="w-full h-8 text-xs font-bold tracking-tight bg-primary hover:bg-primary/90">
          Upgade Now
        </Button>
      </div>
    </aside>
  );
}
