"use client";

import Link from "next/link";
import { ArrowUpRight, Clock3, Search, SlidersHorizontal } from "lucide-react";
import { ShareJobButton } from "@/components/jobs/share-job-button";
import { SiteShell } from "@/components/site-shell";
import { Stars } from "@/components/stars";
import { EmptyState } from "@/components/ui/empty-state";
import { JobCardSkeleton } from "@/components/ui/skeleton";
import { useJobBoard } from "@/hooks/use-job-board";
import { formatDate, formatUsdc, shortenAddress } from "@/lib/format";

const sortOptions = [
  { id: "chronological", label: "Newest" },
  { id: "budget", label: "Highest Budget" },
  { id: "reputation", label: "Best Client Reputation" },
] as const;

export default function JobsPage() {
  const { jobs, loading, error, query, activeTag, sortBy, availableTags, actions } =
    useJobBoard();

  function resetFilters() {
    actions.setQuery("");
    actions.setActiveTag("all");
    actions.setSortBy("chronological");
  }

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
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="group rounded-[1.75rem] border border-slate-200 bg-white/85 p-6 shadow-[0_20px_60px_-45px_rgba(15,23,42,0.55)] transition hover:-translate-y-1 hover:border-amber-300"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
                      {job.status}
                    </p>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                      {job.title}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <ShareJobButton
                      path={`/jobs/${job.id}`}
                      title={job.title}
                      className="border-slate-200 bg-white/95"
                    />
                    <ArrowUpRight className="h-5 w-5 text-slate-400 transition group-hover:text-slate-950" />
                  </div>
                </div>

                <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-600">
                  {job.description}
                </p>

                <div className="mt-5 flex flex-wrap gap-2">
                  {job.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="mt-6 grid gap-4 rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                      Budget
                    </p>
                    <p className="mt-2 text-lg font-semibold text-slate-950">
                      {formatUsdc(job.budget_usdc)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                      Deadline
                    </p>
                    <p className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                      <Clock3 className="h-4 w-4 text-amber-600" />
                      {formatDate(job.deadlineAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                      Milestones
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-700">
                      {job.milestones} tracked approvals
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                      Client
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-700">
                      {shortenAddress(job.client_address)}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                      <Stars value={job.clientReputation.starRating} />
                      {job.clientReputation.averageStars.toFixed(1)}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {job.clientReputation.totalJobs} completed jobs on-chain
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {!loading && jobs.length === 0 ? (
          <EmptyState
            icon={<Search className="h-5 w-5" />}
            title="No open jobs matched that filter"
            description="Try clearing your search and tag filter to surface more opportunities."
            action={
              <button
                type="button"
                onClick={resetFilters}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-amber-300 hover:text-slate-950"
              >
                Reset filters
              </button>
            }
          />
        ) : null}
      </section>
    </SiteShell>
  );
}
