import { GlassCard } from "@/components/ui/glass-card";
import { Stars } from "@/components/stars";
import { ReputationMetrics } from "@/lib/reputation";
import { Wallet, ShieldCheck, TrendingUp } from "lucide-react";

interface JobSidebarProps {
  viewerAddress: string | null;
  clientReputation: ReputationMetrics | null;
  freelancerReputation: ReputationMetrics | null;
}

export function JobSidebar({
  viewerAddress,
  clientReputation,
  freelancerReputation,
}: JobSidebarProps) {
  return (
    <aside className="space-y-6">
      <GlassCard className="space-y-4">
        <div className="flex items-center gap-2 text-indigo-400">
          <Wallet className="h-4 w-4" />
          <h3 className="text-sm font-bold uppercase tracking-widest">Active Wallet</h3>
        </div>
        <div className="rounded-lg bg-zinc-950 p-3 font-mono text-xs text-zinc-400 break-all border border-zinc-800">
          {viewerAddress ?? "No wallet connected"}
        </div>
      </GlassCard>

      <GlassCard className="space-y-6">
        <div className="flex items-center gap-2 text-emerald-400">
          <ShieldCheck className="h-4 w-4" />
          <h3 className="text-sm font-bold uppercase tracking-widest">Trust Metrics</h3>
        </div>
        
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-tighter">Client Score</p>
            <div className="flex items-center justify-between">
              <Stars value={clientReputation?.starRating ?? 0} />
              <span className="text-lg font-bold text-white">{clientReputation?.averageStars.toFixed(1) ?? "0.0"}</span>
            </div>
            <p className="text-[10px] text-zinc-600">{clientReputation?.totalJobs ?? 0} verified contracts</p>
          </div>

          {freelancerReputation && (
            <div className="space-y-2 border-t border-zinc-800 pt-4">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-tighter">Freelancer Score</p>
              <div className="flex items-center justify-between">
                <Stars value={freelancerReputation.starRating} />
                <span className="text-lg font-bold text-white">{freelancerReputation.averageStars.toFixed(1)}</span>
              </div>
              <p className="text-[10px] text-zinc-600">{freelancerReputation.totalJobs} completed jobs</p>
            </div>
          )}
        </div>
      </GlassCard>

      <GlassCard className="bg-indigo-500/10 border-indigo-500/20">
        <div className="flex items-center gap-2 text-indigo-400 mb-3">
          <TrendingUp className="h-4 w-4" />
          <h3 className="text-sm font-bold uppercase tracking-widest">Network Pulse</h3>
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed">
          This contract is secured by the Stellar network. Payments are held in a non-custodial escrow until conditions are met.
        </p>
      </GlassCard>
    </aside>
  );
}
