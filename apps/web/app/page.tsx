import { SiteShell } from "@/components/site-shell";
import { RoleOverview } from "@/components/dashboard/role-overview";

export default function Home() {
  return (
    <SiteShell
      eyebrow="Stellar Freelance Infrastructure"
      title="Premium freelance execution with escrow, verifiable reputation, and transparent AI arbitration."
      description="Lance is the surface layer for serious clients and elite independents who want payment security, immutable trust signals, and fast dispute resolution without losing clarity."
    >
      <RoleOverview />
    </SiteShell>
  );
}
