"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { JobCard, JobCardSkeleton } from "@/components/jobs/job-card";
import { JobCardErrorBoundary } from "@/components/jobs/job-card-error-boundary";
import { useJobBoard } from "@/hooks/use-job-board";

const sortOptions = [
  { id: "chronological", label: "Newest" },
  { id: "budget", label: "Highest Budget" },
  { id: "reputation", label: "Best Client Reputation" },
] as const;

export default function JobsPage() {
  const { jobs, loading, error, query, activeTag, sortBy, availableTags, actions } =
    useJobBoard();

  return (
    <SiteShell
      eyebrow="Marketplace"
      title="Find open work with clean trust signals before you even open the brief."
      description="The board hydrates open jobs from the backend, layers in client reputation from Soroban, and keeps filtering responsive enough to scan dozens of listings without friction."
    >
      <section className="rounded-[2rem] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_25px_80px_-50px_rgba(15,23,42,0.5)] sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-zinc-900/50 px-4 py-3">
            <Search className="h-4 w-4 text-zinc-500" />
            <input
              value={query}
              onChange={(event) => actions.setQuery(event.target.value)}
              placeholder="Search by stack, brief, or client wallet"
              className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
            />
          </label>
          <div className="flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-zinc-900/50 p-2">
            <div className="inline-flex items-center gap-2 rounded-xl bg-zinc-800 px-3 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
              <SlidersHorizontal className="h-4 w-4" />
              Sort
            </div>
            {sortOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => actions.setSortBy(option.id)}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                  sortBy === option.id
                    ? "bg-amber-500 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:text-zinc-100"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {availableTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => actions.setActiveTag(tag)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                activeTag === tag
                  ? "bg-amber-500 text-white"
                  : "border border-white/10 bg-zinc-900/50 text-zinc-400 hover:border-amber-500/30 hover:text-zinc-100"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
            Live API data was unavailable, so the board is showing resilient mock
            listings instead. {error}
          </div>
        ) : null}
      </section>

      <section className="mt-8">
        {loading ? (
          <div className="grid gap-4 lg:grid-cols-2" role="status" aria-live="polite">
            {Array.from({ length: 6 }, (_, index) => (
              <JobCardSkeleton key={index} />
            ))}
            <span className="sr-only">Loading open jobs</span>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {jobs.map((job) => (
              <JobCardErrorBoundary key={job.id}>
                <JobCard job={job} />
              </JobCardErrorBoundary>
            ))}
          </div>
        )}

        {!loading && jobs.length === 0 ? (
          <div className="rounded-[1.75rem] border border-dashed border-white/20 bg-white/5 px-6 py-16 text-center text-zinc-400">
            No open jobs matched that filter.
          </div>
        ) : null}
      </section>
    </SiteShell>
  );
}
