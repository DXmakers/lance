"use client";

/**
 * /milestones — Freelancer milestone dashboard
 *
 * Shows all active contracts with their milestone progress in a
 * Zinc-950 glassmorphism layout with high-contrast status indicators.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Briefcase,
  CheckCircle2,
  Clock3,
  Coins,
  LoaderCircle,
  TrendingUp,
} from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { MilestoneTracker } from "@/components/jobs/milestone-tracker";
import { api, type Job, type Milestone, type Deliverable } from "@/lib/api";
import { formatUsdc, shortenAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContractWorkspace {
  job: Job;
  milestones: Milestone[];
  deliverables: Deliverable[];
}

// ── Status badge ──────────────────────────────────────────────────────────────

const JOB_STATUS_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  funded: {
    label: "Funded",
    className: "bg-sky-500/15 text-sky-400 border-sky-500/25",
  },
  active: {
    label: "Active",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  },
  deliverable_submitted: {
    label: "Under Review",
    className: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  },
  completed: {
    label: "Completed",
    className: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  },
  disputed: {
    label: "Disputed",
    className: "bg-red-500/15 text-red-400 border-red-500/25",
  },
};

function JobStatusBadge({ status }: { status: string }) {
  const config = JOB_STATUS_CONFIG[status] ?? {
    label: status,
    className: "bg-zinc-700/50 text-zinc-400 border-zinc-600/40",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold",
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}

// ── Contract card ─────────────────────────────────────────────────────────────

function ContractCard({ workspace }: { workspace: ContractWorkspace }) {
  const { job, milestones, deliverables } = workspace;
  const released = milestones.filter((m) => m.status === "released").length;
  const total = milestones.length;
  const pct = total === 0 ? 0 : Math.round((released / total) * 100);

  return (
    <article className="rounded-2xl border border-zinc-800/70 bg-zinc-950/80 shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_16px_48px_-16px_rgba(0,0,0,0.5)] backdrop-blur-md">
      {/* Contract header */}
      <div className="flex items-start justify-between gap-4 p-5 pb-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <JobStatusBadge status={job.status} />
            <span className="text-[10px] font-medium text-zinc-600">
              {pct}% complete
            </span>
          </div>
          <h3 className="mt-2 truncate text-sm font-semibold text-zinc-100">
            {job.title}
          </h3>
          <p className="mt-1 text-[12px] text-zinc-500">
            Client: {shortenAddress(job.client_address)}
          </p>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="flex items-center gap-1.5 text-sm font-bold tabular-nums text-zinc-100">
            <Coins className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
            {formatUsdc(job.budget_usdc)}
          </div>
          <p className="mt-1 text-[11px] text-zinc-600">
            {total} milestone{total !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Mini progress bar */}
      <div className="px-5 pb-4">
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${pct}% of milestones released`}
          className="h-1 w-full overflow-hidden rounded-full bg-zinc-800"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-600">
          <span>{released} released</span>
          <span>{total - released} pending</span>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-5 h-px bg-zinc-800/60" aria-hidden="true" />

      {/* Milestone tracker */}
      <div className="p-5 pt-4">
        <MilestoneTracker
          milestones={milestones}
          deliverables={deliverables}
          jobStatus={job.status}
          isClient={false}
          workflowLocked={job.status === "disputed"}
        />
      </div>

      {/* Footer link */}
      <div className="border-t border-zinc-800/60 px-5 py-3">
        <Link
          href={`/jobs/${job.id}`}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-zinc-500 transition-colors duration-150 hover:text-zinc-300"
        >
          Open full workspace
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyContracts() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/50 px-8 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800/80 ring-1 ring-zinc-700/60">
        <Briefcase className="h-6 w-6 text-zinc-500" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-semibold text-zinc-300">No active contracts</p>
        <p className="mt-1 max-w-xs text-[12px] leading-5 text-zinc-600">
          When a client accepts your bid and funds the escrow, your milestones will appear here.
        </p>
      </div>
      <Link
        href="/jobs"
        className="mt-2 inline-flex items-center gap-2 rounded-full bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 ring-1 ring-zinc-700/60 transition-all duration-150 hover:bg-zinc-700 hover:text-zinc-100"
      >
        Browse open jobs
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

// ── Summary strip ─────────────────────────────────────────────────────────────

function SummaryStrip({
  workspaces,
}: {
  workspaces: ContractWorkspace[];
}) {
  const totalMilestones = workspaces.reduce(
    (sum, w) => sum + w.milestones.length,
    0,
  );
  const releasedMilestones = workspaces.reduce(
    (sum, w) => sum + w.milestones.filter((m) => m.status === "released").length,
    0,
  );
  const totalEarned = workspaces.reduce(
    (sum, w) =>
      sum +
      w.milestones
        .filter((m) => m.status === "released")
        .reduce((s, m) => s + m.amount_usdc, 0),
    0,
  );
  const activeContracts = workspaces.filter(
    (w) => !["completed", "disputed"].includes(w.job.status),
  ).length;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        {
          label: "Active Contracts",
          value: String(activeContracts),
          icon: <Briefcase className="h-4 w-4 text-sky-400" />,
          color: "text-sky-400",
        },
        {
          label: "Milestones Released",
          value: `${releasedMilestones}/${totalMilestones}`,
          icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
          color: "text-emerald-400",
        },
        {
          label: "Pending Milestones",
          value: String(totalMilestones - releasedMilestones),
          icon: <Clock3 className="h-4 w-4 text-amber-400" />,
          color: "text-amber-400",
        },
        {
          label: "Total Earned",
          value: formatUsdc(totalEarned),
          icon: <TrendingUp className="h-4 w-4 text-zinc-400" />,
          color: "text-zinc-200",
        },
      ].map((stat) => (
        <div
          key={stat.label}
          className="rounded-xl border border-zinc-800/70 bg-zinc-950/80 px-4 py-3 ring-1 ring-zinc-800/40"
        >
          <div className="flex items-center gap-2">
            {stat.icon}
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
              {stat.label}
            </span>
          </div>
          <p className={cn("mt-2 text-xl font-bold tabular-nums", stat.color)}>
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MilestonesPage() {
  const [workspaces, setWorkspaces] = useState<ContractWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const jobs = await api.jobs.list();
        // Filter to jobs that have milestones (non-open)
        const activeJobs = jobs.filter((j) => j.status !== "open");

        const workspaceData = await Promise.all(
          activeJobs.map(async (job) => {
            const [milestones, deliverables] = await Promise.all([
              api.jobs.milestones(job.id).catch(() => []),
              api.jobs.deliverables.list(job.id).catch(() => []),
            ]);
            return { job, milestones, deliverables };
          }),
        );

        setWorkspaces(workspaceData);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load contracts");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  return (
    <SiteShell
      eyebrow="Milestones"
      title="Your active contract milestones"
      description="Track payment checkpoints across all your active contracts. Each milestone is anchored on-chain via the Soroban escrow contract."
    >
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoaderCircle
            className="h-6 w-6 animate-spin text-zinc-600"
            aria-label="Loading contracts"
          />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/8 px-5 py-4 text-sm text-red-400">
          {error}
        </div>
      ) : (
        <div className="space-y-6">
          {workspaces.length > 0 && (
            <SummaryStrip workspaces={workspaces} />
          )}

          {workspaces.length === 0 ? (
            <EmptyContracts />
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              {workspaces.map((workspace) => (
                <ContractCard key={workspace.job.id} workspace={workspace} />
              ))}
            </div>
          )}
        </div>
      )}
    </SiteShell>
  );
}
