import { GlassCard } from "@/components/ui/glass-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatUsdc } from "@/lib/format";
import { Job } from "@/lib/api";

interface JobHeaderProps {
  job: Job;
}

export function JobHeader({ job }: JobHeaderProps) {
  return (
    <GlassCard className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <StatusBadge status={job.status} />
          <span className="text-xs text-zinc-500 font-mono tracking-tighter">
            ID: {job.id.slice(0, 8)}
          </span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white lg:text-4xl">
          {job.title}
        </h1>
        <p className="max-w-2xl text-zinc-400 leading-relaxed">
          {job.description}
        </p>
      </div>

      <div className="flex flex-col items-start gap-1 lg:items-end">
        <span className="text-xs uppercase tracking-widest text-zinc-500 font-semibold">
          Budget (USDC)
        </span>
        <div className="text-3xl font-bold text-white tabular-nums">
          {formatUsdc(job.budget_usdc)}
        </div>
        <div className="text-xs text-indigo-400 font-medium">
          {job.milestones} Milestones in Escrow
        </div>
      </div>
    </GlassCard>
  );
}
