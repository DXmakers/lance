"use client";

import { SiteShell } from "@/components/site-shell";
import { RoleOverview } from "@/components/dashboard/role-overview";
import { ClientDashboard } from "@/components/dashboard/client-dashboard";
import { useAuthStore } from "@/lib/store/use-auth-store";
import { WalletConnect } from "@/components/WalletConnect";

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
      {!isLoggedIn && (
        <div className="mb-12 flex justify-center">
          <WalletConnect />
        </div>
      )}
      {role === "client" ? <ClientDashboard /> : <RoleOverview />}
    </SiteShell>
  );
}
