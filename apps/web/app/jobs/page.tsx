"use client";

import React, { Suspense, useState, useDeferredValue } from "react";
import { SiteShell } from "@/components/site-shell";
import { useJobs, BoardJob, JobSort } from "@/hooks/job-queries";
import { JobCard } from "@/components/jobs/JobCard";
import { JobFilters, FilterValues } from "@/components/jobs/JobFilters";
import { AlertCircle, Loader2 } from "lucide-react";

/**
 * ErrorBoundary fallback component.
 */
function ErrorFallback({ error }: { error: Error }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 rounded-2xl border border-red-500/20 bg-red-500/5 backdrop-blur-md">
      <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
      <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
      <p className="text-zinc-400 text-center text-sm max-w-md">
        {error.message || "Failed to load the job board. Please check your network connection and try again."}
      </p>
      <button 
        onClick={() => window.location.reload()}
        className="mt-6 px-6 py-2 bg-zinc-100 text-zinc-950 font-bold rounded-lg hover:bg-white transition-colors"
      >
        Try Again
      </button>
    </div>
  );
}

/**
 * Simple ErrorBoundary implementation for the page.
 */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error!} />;
    }
    return this.props.children;
  }
}

function JobListContent() {
  const { data: jobs, isLoading, error } = useJobs();
  const [filters, setFilters] = useState<FilterValues>({
    query: "",
    sortBy: "chronological",
    activeTag: "all",
  });

  const deferredQuery = useDeferredValue(filters.query);

  if (isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2" role="status" aria-live="polite">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[280px] rounded-xl bg-zinc-900/50 border border-zinc-800 animate-pulse" />
        ))}
        <span className="sr-only">Loading jobs...</span>
      </div>
    );
  }

  if (error) {
    throw error; // Let ErrorBoundary handle it
  }

  const tags = ["all", ...new Set(jobs?.flatMap((j) => j.tags) || [])];

  let filteredJobs = jobs?.filter((j) => j.status === "open") || [];

  if (filters.activeTag !== "all") {
    filteredJobs = filteredJobs.filter((j) => j.tags.includes(filters.activeTag));
  }

  if (deferredQuery?.trim()) {
    const term = deferredQuery.trim().toLowerCase();
    filteredJobs = filteredJobs.filter((j) =>
      [j.title, j.description, j.client_address, ...j.tags]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }

  const sortedJobs = [...filteredJobs].sort((a, b) => {
    if (filters.sortBy === "budget") return b.budget_usdc - a.budget_usdc;
    if (filters.sortBy === "reputation") return b.clientReputation.scoreBps - a.clientReputation.scoreBps;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-[300px_1fr] gap-12">
      <aside className="lg:sticky lg:top-12 self-start">
        <JobFilters 
          values={filters} 
          onChange={setFilters} 
          tags={tags} 
        />
      </aside>

      <main className="flex-1">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.2em]">
            Showing {sortedJobs.length} active listings
          </h2>
          {isLoading && <Loader2 className="h-4 w-4 text-zinc-500 animate-spin" />}
        </div>

        {sortedJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/10">
            <p className="text-zinc-500 text-sm italic">No jobs found matching your criteria.</p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-1 xl:grid-cols-2">
            {sortedJobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default function JobsPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <SiteShell
        eyebrow="Marketplace"
        title="Find open work with verified on-chain signals."
        description="The decentralized board hydrates jobs directly from the protocol, layering in real-time reputation and milestone status for a high-trust experience."
      >
        <div className="max-w-7xl mx-auto py-12">
          <ErrorBoundary>
            <JobListContent />
          </ErrorBoundary>
        </div>
      </SiteShell>
    </div>
  );
}
