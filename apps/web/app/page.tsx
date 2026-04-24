"use client";

import { SiteShell } from "@/components/site-shell";
import { RoleOverview } from "@/components/dashboard/role-overview";
import { ClientDashboard } from "@/components/dashboard/client-dashboard";
import { useAuthStore } from "@/lib/store/use-auth-store";

export default function Home() {
  const { role, isLoggedIn } = useAuthStore();

  const eyebrow = isLoggedIn ? `${role} cockpit` : "Stellar Freelance Infrastructure";
  const title = role === 'client' ? "Manage hiring and escrow milestones with absolute clarity." : "Premium freelance execution with escrow, verifiable reputation, and transparent AI arbitration.";

  return (
    <SiteShell
      eyebrow={eyebrow}
      title={title}
      description="Lance is the surface layer for serious clients and elite independents who want payment security, immutable trust signals, and fast dispute resolution."
    >
      {role === "client" ? <ClientDashboard /> : <RoleOverview />}
    </SiteShell>
  );
}
