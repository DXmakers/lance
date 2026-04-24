"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { JobCard } from "@/components/jobs/job-card";
import { JobCardSkeleton } from "@/components/ui/skeleton";
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
      <section className="rounded-[2rem] border border-slate-200 bg-white/85 p-5 shadow-[0_25px_80px_-50px_rgba(15,23,42,0.5)] sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => actions.setQuery(event.target.value)}
              placeholder="Search by stack, brief, or client wallet"
              className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
          </label>
          <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
            <div className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
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
                    ? "bg-slate-950 text-white"
                    : "bg-white text-slate-600 hover:text-slate-950"
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
                  : "border border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:text-slate-950"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
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
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        )}

        {!loading && jobs.length === 0 ? (
          <div className="rounded-[1.75rem] border border-dashed border-slate-300 bg-white/70 px-6 py-16 text-center text-slate-500">
            No open jobs matched that filter.
          </div>
        ) : null}
      </section>
    </SiteShell>
  );
}
