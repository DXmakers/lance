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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";


interface NavItemProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
}

function NavItem({ href, icon, label, badge }: NavItemProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

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
      {badge ? (
        <Badge variant={isActive ? "default" : "secondary"} className="rounded-full">
          {badge}
        </Badge>
      ) : null}
      {isActive && <div className="h-1.5 w-1.5 rounded-full bg-primary" />}
    </Link>
  );
}

const DASHBOARD_LINKS: Record<string, NavItemProps[]> = {
  client: [
    { href: "/", icon: <LayoutDashboard className="h-4 w-4" />, label: "Overview" },
    { href: "/jobs/new", icon: <PlusCircle className="h-4 w-4" />, label: "Post a Job" },
    { href: "/jobs", icon: <Briefcase className="h-4 w-4" />, label: "My Jobs", badge: "12" },
    { href: "/profile/GD...CLIENT", icon: <Users className="h-4 w-4" />, label: "Find Talent" },
    { href: "/disputes/1", icon: <MessageSquare className="h-4 w-4" />, label: "Disputes" },
    { href: "/jobs/1", icon: <BarChart2 className="h-4 w-4" />, label: "Escrow Analytics" },
    { href: "/profile/GD...CLIENT", icon: <Settings className="h-4 w-4" />, label: "Settings" },
  ],
  freelancer: [
    { href: "/", icon: <LayoutDashboard className="h-4 w-4" />, label: "Overview" },
    { href: "/jobs", icon: <SearchIcon className="h-4 w-4" />, label: "Find Work", badge: "24" },
    { href: "/jobs/1", icon: <FileText className="h-4 w-4" />, label: "Active Contracts" },
    { href: "/milestones", icon: <TrendingUp className="h-4 w-4" />, label: "Milestones" },
    { href: "/disputes/1", icon: <MessageSquare className="h-4 w-4" />, label: "Disputes" },
    { href: "/profile/GD...CLIENT", icon: <Settings className="h-4 w-4" />, label: "Profile Settings" },
  ],
  'logged-out': [
    { href: "/", icon: <Home className="h-4 w-4" />, label: "Home" },
    { href: "/jobs", icon: <Zap className="h-4 w-4" />, label: "Explore Lance" },
    { href: "/disputes/1", icon: <ShieldCheck className="h-4 w-4" />, label: "Trust & Safety" },
  ],
};



export function Sidebar({ className }: { className?: string }) {
  const { role, isLoggedIn, user } = useAuthStore();
  const links = DASHBOARD_LINKS[role] || DASHBOARD_LINKS['logged-out'];

  return (
    <aside className={cn("hidden h-[calc(100vh-6rem)] w-64 flex-col rounded-[2rem] border border-border/60 glass-surface px-4 py-5 md:flex", className)}>
      <div className="rounded-[1.5rem] border border-border/60 bg-background/40 p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-muted-foreground">
          Workspace mode
        </p>
        <h2 className="mt-2 text-lg font-semibold capitalize text-foreground">
          {isLoggedIn ? `${role} cockpit` : "public preview"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isLoggedIn
            ? `Signed in as ${user?.name ?? "Lance operator"}`
            : "Switch roles from the top bar to preview each navigation path."}
        </p>
      </div>

      <Separator className="my-4" />

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

      <div className="mt-auto rounded-[1.5rem] border border-primary/15 bg-primary/5 p-4">
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
          Upgrade Now
        </Button>
      </div>
    </aside>
  );
}
