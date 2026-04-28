"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  Briefcase,
  Clock3,
  DollarSign,
  Filter,
  Layers,
  Plus,
  Search,
  Shield,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { ShareJobButton } from "@/components/jobs/share-job-button";
import { Stars } from "@/components/stars";
import { EmptyState } from "@/components/ui/empty-state";
import { JobCardSkeleton } from "@/components/ui/skeleton";
import { useJobBoard } from "@/hooks/use-job-board";
import { formatDate, formatUsdc, shortenAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BoardJob } from "@/hooks/use-job-board";

// ─── Sort options ────────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { id: "chronological", label: "Newest", icon: <Clock3 className="h-3.5 w-3.5" /> },
  { id: "budget", label: "Top Budget", icon: <TrendingUp className="h-3.5 w-3.5" /> },
  { id: "reputation", label: "Best Client", icon: <Shield className="h-3.5 w-3.5" /> },
] as const;

// ─── Status config ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; dot: string; text: string; bg: string }> = {
  open: {
    label: "Open",
    dot: "bg-emerald-500",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/20",
  },
  pending: {
    label: "Pending",
    dot: "bg-amber-500",
    text: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
  in_progress: {
    label: "In Progress",
    dot: "bg-indigo-400",
    text: "text-indigo-400",
    bg: "bg-indigo-500/10 border-indigo-500/20",
  },
  completed: {
    label: "Completed",
    dot: "bg-zinc-500",
    text: "text-zinc-400",
    bg: "bg-zinc-500/10 border-zinc-500/20",
  },
};

function getStatusConfig(status: string) {
  return (
    STATUS_CONFIG[status] ?? {
      label: status,
      dot: "bg-zinc-500",
      text: "text-zinc-400",
      bg: "bg-zinc-500/10 border-zinc-500/20",
    }
  );
}

// ─── Tag pill ────────────────────────────────────────────────────────────────

const TAG_COLORS: Record<string, string> = {
  soroban: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  frontend: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  design: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  devops: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  ai: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  growth: "bg-teal-500/10 text-teal-400 border-teal-500/20",
  general: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};

function TagPill({ tag }: { tag: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition-all duration-150",
        TAG_COLORS[tag] ?? "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
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
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
        cfg.bg,
        cfg.text,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
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
    <div className="flex flex-col gap-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </p>
      <div
        className={cn(
          "flex items-center gap-1.5 text-sm font-semibold",
          accent ? "text-zinc-100" : "text-zinc-300",
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
        "group relative flex flex-col overflow-hidden rounded-3xl border border-zinc-800/80",
        "bg-zinc-900/60 backdrop-blur-sm",
        "shadow-[0_4px_24px_-8px_rgba(0,0,0,0.5)]",
        "transition-all duration-150",
        "hover:-translate-y-0.5 hover:border-zinc-700 hover:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.7)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
      )}
      aria-label={`View job: ${job.title}`}
    >
      {/* Subtle top gradient accent */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zinc-600/60 to-transparent"
        aria-hidden="true"
      />

      <div className="flex flex-1 flex-col gap-5 p-6">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <StatusBadge status={job.status} />
            <h2 className="text-lg font-semibold leading-snug tracking-tight text-zinc-100 transition-colors duration-150 group-hover:text-white">
              {job.title}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ShareJobButton
              path={`/jobs/${job.id}`}
              title={job.title}
              className="border-zinc-700/80 bg-zinc-800/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            />
            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-700/80 bg-zinc-800/60 text-zinc-500 transition-all duration-150 group-hover:border-zinc-600 group-hover:text-zinc-200">
              <ArrowUpRight className="h-4 w-4" />
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="line-clamp-2 text-sm leading-relaxed text-zinc-500 transition-colors duration-150 group-hover:text-zinc-400">
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

        {/* Stats grid */}
        <div className="mt-auto grid grid-cols-3 gap-4 rounded-2xl border border-zinc-800/80 bg-zinc-950/50 p-4">
          <StatCell
            label="Budget"
            value={formatUsdc(job.budget_usdc)}
            icon={<DollarSign className="h-3.5 w-3.5 text-emerald-500" />}
            accent
          />
          <StatCell
            label="Deadline"
            value={formatDate(job.deadlineAt)}
            icon={<Clock3 className="h-3.5 w-3.5 text-amber-500" />}
          />
          <StatCell
            label="Milestones"
            value={`${job.milestones} steps`}
            icon={<Layers className="h-3.5 w-3.5 text-indigo-400" />}
          />
        </div>

        {/* Footer: client + reputation */}
        <div className="flex items-center justify-between gap-4 border-t border-zinc-800/60 pt-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-700/80 bg-zinc-800/80">
              <Users className="h-3.5 w-3.5 text-zinc-500" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                Client
              </p>
              <p className="font-mono text-xs font-medium text-zinc-400">
                {shortenAddress(job.client_address)}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1.5">
              <Stars value={job.clientReputation.starRating} />
              <span className="text-xs font-semibold text-zinc-300">
                {job.clientReputation.averageStars.toFixed(1)}
              </span>
            </div>
            <p className="text-[10px] text-zinc-600">
              {job.clientReputation.totalJobs} on-chain jobs
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ─── Skeleton grid ───────────────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      role="status"
      aria-live="polite"
      aria-label="Loading jobs"
    >
      {Array.from({ length: 6 }, (_, i) => (
        <JobCardSkeleton key={i} />
      ))}
      <span className="sr-only">Loading open jobs…</span>
    </div>
  );
}

// ─── Stats bar ───────────────────────────────────────────────────────────────

function StatsBar({ total, filtered }: { total: number; filtered: number }) {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-500">
      <span className="font-semibold text-zinc-300">{filtered}</span>
      <span>of</span>
      <span className="font-semibold text-zinc-300">{total}</span>
      <span>open jobs</span>
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
    actions,
  } = useJobBoard();

  const totalOpen = paginatedJobs.length;

  function resetFilters() {
    actions.setQuery("");
    actions.setActiveTag("all");
    actions.setSortBy("chronological");
  }

  return (
    <div className="flex min-h-screen flex-col gap-8 bg-zinc-950 pb-16">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <header className="relative overflow-hidden rounded-3xl border border-zinc-800/80 bg-zinc-900/60 px-6 py-8 backdrop-blur-sm sm:px-8">
        {/* Radial glow accents */}
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 10% 0%, rgba(99,102,241,0.08) 0%, transparent 60%), radial-gradient(ellipse 40% 40% at 90% 100%, rgba(16,185,129,0.06) 0%, transparent 60%)",
          }}
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1">
              <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-400">
                Marketplace
              </span>
            </div>
            <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
              Find open work with clean trust signals
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-zinc-500">
              Live jobs from the Soroban registry — filtered, sorted, and layered with
              on-chain client reputation before you open a single brief.
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-3">
            <Link
              href="/jobs/new"
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-5 py-2.5",
                "bg-indigo-600 text-sm font-semibold text-white",
                "shadow-[0_0_20px_-4px_rgba(99,102,241,0.4)]",
                "transition-all duration-150 hover:bg-indigo-500 hover:shadow-[0_0_28px_-4px_rgba(99,102,241,0.55)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
              )}
            >
              <Plus className="h-4 w-4" />
              Post a Job
            </Link>
          </div>
        </div>

        {/* Live indicator */}
        <div className="relative mt-6 flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-xs font-medium text-zinc-500">
            Live — synced with Soroban testnet
          </span>
        </div>
      </header>

      {/* ── Filter & sort bar ────────────────────────────────────────────── */}
      <section
        aria-label="Filter and sort jobs"
        className="rounded-3xl border border-zinc-800/80 bg-zinc-900/60 p-4 backdrop-blur-sm sm:p-5"
      >
        <div className="flex flex-col gap-4">
          {/* Search + sort row */}
          <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
            {/* Search */}
            <label
              htmlFor="job-search"
              className={cn(
                "flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 px-4 py-3",
                "transition-all duration-150 focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/30",
              )}
            >
              <Search className="h-4 w-4 shrink-0 text-zinc-600" aria-hidden="true" />
              <input
                id="job-search"
                type="search"
                value={query}
                onChange={(e) => actions.setQuery(e.target.value)}
                placeholder="Search by title, stack, or client wallet…"
                className="w-full bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
                aria-label="Search jobs"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => actions.setQuery("")}
                  className="text-xs text-zinc-600 transition-colors hover:text-zinc-400"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </label>

            {/* Sort pills */}
            <div
              role="group"
              aria-label="Sort jobs"
              className="flex items-center gap-1.5 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-1.5"
            >
              <div className="flex items-center gap-1.5 px-2 text-zinc-600">
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              </div>
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => actions.setSortBy(opt.id)}
                  aria-pressed={sortBy === opt.id}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all duration-150",
                    sortBy === opt.id
                      ? "bg-indigo-600 text-white shadow-[0_0_12px_-2px_rgba(99,102,241,0.5)]"
                      : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300",
                  )}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tag filter row */}
          <div
            role="group"
            aria-label="Filter by tag"
            className="flex flex-wrap items-center gap-2"
          >
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-600">
              <Filter className="h-3 w-3" aria-hidden="true" />
              Filter
            </span>
            {availableTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => actions.setActiveTag(tag)}
                aria-pressed={activeTag === tag}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold capitalize transition-all duration-150",
                  activeTag === tag
                    ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-300 shadow-[0_0_10px_-2px_rgba(99,102,241,0.3)]"
                    : "border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300",
                )}
              >
                {tag === "all" ? "All Jobs" : tag}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
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

      {/* ── Results header ───────────────────────────────────────────────── */}
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

      {/* ── Job grid ─────────────────────────────────────────────────────── */}
      <main aria-label="Job listings">
        {loading ? (
          <SkeletonGrid />
        ) : paginatedJobs.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {paginatedJobs.map((job) => (
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

      {/* ── Bottom CTA ───────────────────────────────────────────────────── */}
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
            <Link
              href="/jobs/new"
              className={cn(
                "inline-flex shrink-0 items-center gap-2 rounded-full px-6 py-3",
                "bg-indigo-600 text-sm font-semibold text-white",
                "shadow-[0_0_20px_-4px_rgba(99,102,241,0.4)]",
                "transition-all duration-150 hover:bg-indigo-500",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
              )}
            >
              <Plus className="h-4 w-4" />
              Launch a Brief
            </Link>
          </div>
        </footer>
      )}
    </div>
  );
}