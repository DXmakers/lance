"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  Briefcase,
  Clock3,
  DollarSign,
  Layers,
  Plus,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { ShareJobButton } from "@/components/jobs/share-job-button";
import { JobFilters } from "@/components/jobs/job-filters";
import { Stars } from "@/components/stars";
import { EmptyState } from "@/components/ui/empty-state";
import { JobCardSkeleton } from "@/components/ui/skeleton";
import { useJobBoard } from "@/hooks/use-job-board";
import { formatDate, formatUsdc, shortenAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BoardJob } from "@/hooks/use-job-board";

// ─── Status config ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; dot: string; text: string; bg: string }> = {
  open: {
    label: "Open",
    dot: "bg-emerald-500",
    text: "text-emerald-500",
    bg: "bg-emerald-500/5 border-emerald-500/20",
  },
  pending: {
    label: "Pending",
    dot: "bg-amber-500",
    text: "text-amber-500",
    bg: "bg-amber-500/5 border-amber-500/20",
  },
  in_progress: {
    label: "In Progress",
    dot: "bg-indigo-500",
    text: "text-indigo-400",
    bg: "bg-indigo-500/5 border-indigo-500/20",
  },
  completed: {
    label: "Completed",
    dot: "bg-zinc-400",
    text: "text-zinc-400",
    bg: "bg-zinc-400/5 border-zinc-400/20",
  },
};

function getStatusConfig(status: string) {
  return (
    STATUS_CONFIG[status] ?? {
      label: status,
      dot: "bg-zinc-500",
      text: "text-zinc-500",
      bg: "bg-zinc-500/5 border-zinc-500/20",
    }
  );
}

// ─── Tag pill ────────────────────────────────────────────────────────────────

const TAG_COLORS: Record<string, string> = {
  soroban: "bg-indigo-500/5 text-indigo-400 border-indigo-500/10",
  frontend: "bg-sky-500/5 text-sky-400 border-sky-500/10",
  design: "bg-pink-500/5 text-pink-400 border-pink-500/10",
  devops: "bg-orange-500/5 text-orange-400 border-orange-500/10",
  ai: "bg-violet-500/5 text-violet-400 border-violet-500/10",
  growth: "bg-teal-500/5 text-teal-400 border-teal-500/10",
  general: "bg-zinc-500/5 text-zinc-400 border-zinc-500/10",
};

function TagPill({ tag }: { tag: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest transition-colors duration-150",
        TAG_COLORS[tag] ?? "bg-zinc-500/5 text-zinc-400 border-zinc-500/10",
      )}
    >
      {tag}
    </span>
  );
}

// ─── Status badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = getStatusConfig(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest",
        cfg.bg,
        cfg.text,
      )}
    >
      <span className={cn("h-1 w-1 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ─── Stat cell ───────────────────────────────────────────────────────────────

function StatCell({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </p>
      <div
        className={cn(
          "flex items-center gap-1.5 text-xs font-semibold",
          accent ? "text-zinc-100" : "text-zinc-400",
        )}
      >
        {icon}
        {value}
      </div>
    </div>
  );
}

// ─── Job card ────────────────────────────────────────────────────────────────

function JobCard({ job }: { job: BoardJob }) {
  return (
    <Link
      href={`/jobs/${job.id}`}
      className={cn(
        "group relative flex flex-col gap-4 overflow-hidden rounded-[12px] border border-zinc-800/50 p-5",
        "bg-zinc-900/40 backdrop-blur-md",
        "transition-all duration-150",
        "hover:border-zinc-700/50 hover:bg-zinc-900/60 hover:shadow-xl",
        "focus:outline-none focus:ring-1 focus:ring-indigo-500/50",
      )}
      aria-label={`View job: ${job.title}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <StatusBadge status={job.status} />
          <h2 className="text-base font-semibold leading-tight tracking-tight text-zinc-100 transition-colors duration-150 group-hover:text-white">
            {job.title}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ShareJobButton
            path={`/jobs/${job.id}`}
            title={job.title}
            className="h-8 w-8 border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-200"
          />
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-zinc-800 bg-zinc-900/50 text-zinc-500 transition-colors duration-150 group-hover:border-zinc-700 group-hover:text-indigo-400">
            <ArrowUpRight className="h-4 w-4" />
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="line-clamp-2 text-xs leading-relaxed text-zinc-500 transition-colors duration-150 group-hover:text-zinc-400">
        {job.description}
      </p>

      {/* Tags */}
      {job.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {job.tags.map((tag) => (
            <TagPill key={tag} tag={tag} />
          ))}
        </div>
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-2 border-t border-zinc-800/50 pt-4">
        <StatCell
          label="Budget"
          value={formatUsdc(job.budget_usdc)}
          icon={<DollarSign className="h-3 w-3 text-emerald-500" />}
          accent
        />
        <StatCell
          label="Deadline"
          value={formatDate(job.deadlineAt)}
          icon={<Clock3 className="h-3 w-3 text-zinc-500" />}
        />
        <StatCell
          label="Steps"
          value={job.milestones}
          icon={<Layers className="h-3 w-3 text-zinc-500" />}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-4 bg-zinc-950/40 -mx-5 -mb-5 px-5 py-3 border-t border-zinc-800/30">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-800/80 border border-zinc-700/50">
            <Users className="h-3 w-3 text-zinc-400" />
          </div>
          <div>
            <p className="font-mono text-[10px] text-zinc-500">
              {shortenAddress(job.client_address)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Stars value={job.clientReputation.starRating} />
          <span className="text-[10px] font-bold text-zinc-400">
            {job.clientReputation.averageStars.toFixed(1)}
          </span>
        </div>
      </div>
    </Link>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <JobCardSkeleton key={i} />
      ))}
    </div>
  );
}

function StatsBar({ total, filtered }: { total: number; filtered: number }) {
  return (
    <div className="flex items-center gap-3 text-xs font-medium text-zinc-500">
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
        <span>{total} Total Listings</span>
      </div>
      {filtered !== total && (
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" />
          <span>{filtered} Matched</span>
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function JobsPage() {
  const {
    paginatedJobs,
    loading,
    error,
    query,
    activeTag,
    sortBy,
    availableTags,
    minBudget,
    maxBudget,
    filterStatus,
    actions,
  } = useJobBoard();

  const totalOpen = paginatedJobs.length;

  function resetFilters() {
    actions.setQuery("");
    actions.setActiveTag("all");
    actions.setSortBy("chronological");
    actions.setMinBudget(undefined);
    actions.setMaxBudget(undefined);
    actions.setFilterStatus("all");
  }

  return (
    <div className="flex min-h-screen flex-col gap-6 bg-zinc-950 p-6 sm:p-8 font-sans">
      {/* Header Section */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-indigo-400">
            <Sparkles className="h-4 w-4" />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Marketplace</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Soroban Job Board
          </h1>
          <p className="max-w-xl text-sm text-zinc-500">
            Discover verified smart contract opportunities with on-chain reputation signals.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full bg-emerald-500/5 border border-emerald-500/10 px-3 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">Testnet Active</span>
          </div>
          <Link
            href="/jobs/new"
            className="inline-flex items-center gap-2 rounded-[12px] bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white transition-all duration-150 hover:bg-indigo-500 hover:shadow-[0_0_20px_-5px_rgba(99,102,241,0.5)] active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            New Job Brief
          </Link>
        </div>
      </div>

      {/* Filter & sort bar */}
      <JobFilters
        query={query}
        setQuery={actions.setQuery}
        activeTag={activeTag}
        setActiveTag={actions.setActiveTag}
        sortBy={sortBy}
        setSortBy={actions.setSortBy}
        availableTags={availableTags as string[]}
        minBudget={minBudget}
        setMinBudget={actions.setMinBudget}
        maxBudget={maxBudget}
        setMaxBudget={actions.setMaxBudget}
        filterStatus={filterStatus}
        setFilterStatus={actions.setFilterStatus}
      />

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-sm text-amber-400"
        >
          <Zap className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span>
            <span className="font-semibold">Live API unavailable</span> — showing
            resilient mock listings. {error}
          </span>
        </div>
      )}

      {/* Results header */}
      {!loading && (
        <div className="flex items-center justify-between gap-4">
          <StatsBar total={totalOpen} filtered={paginatedJobs.length} />
          {(query || activeTag !== "all") && (
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-300"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Job grid */}
      <main aria-label="Job listings">
        {loading ? (
          <SkeletonGrid />
        ) : paginatedJobs.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {paginatedJobs.map((job: BoardJob) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        ) : (
          <EmptyState
            tone="dark"
            icon={<Briefcase className="h-5 w-5" aria-hidden="true" />}
            title="No jobs matched your filters"
            description="Try clearing your search or tag filter to surface more opportunities."
            action={
              <button
                type="button"
                onClick={resetFilters}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-800/60 px-4 py-2",
                  "text-sm font-semibold text-zinc-300 transition-all duration-150",
                  "hover:border-zinc-600 hover:text-zinc-100",
                )}
              >
                Reset filters
              </button>
            }
          />
        )}
      </main>

      {/* Bottom CTA */}
      {!loading && paginatedJobs.length > 0 && (
        <footer className="relative overflow-hidden rounded-3xl border border-zinc-800/80 bg-zinc-900/60 p-6 backdrop-blur-sm sm:p-8">
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
            style={{
              background:
                "radial-gradient(ellipse 50% 80% at 50% 100%, rgba(99,102,241,0.07) 0%, transparent 70%)",
            }}
          />
          <div className="relative flex flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-left">
            <div>
              <p className="text-sm font-semibold text-zinc-200">
                Have a project in mind?
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                Post a job brief and let the right freelancer find you.
              </p>
            </div>
            {error && (
              <div className="flex items-center gap-2 text-[10px] font-bold text-amber-500 uppercase tracking-widest">
                <Zap className="h-3 w-3" />
                <span>Backend Offline: Showing Mocked Data</span>
              </div>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}