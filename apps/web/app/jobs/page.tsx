"use client";

import React, { useState, useDeferredValue, Suspense } from "react";
import { SiteShell } from "@/components/site-shell";
import { useJobs, JOB_CATEGORIES } from "@/hooks/job-queries";
import { JobCard } from "@/components/jobs/JobCard";
import { JobFilters, FilterValues } from "@/components/jobs/JobFilters";
import { JobSkeleton } from "@/components/jobs/JobSkeleton";
import { AlertCircle } from "lucide-react";

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
  const { data: jobs } = useJobs();
  const [filters, setFilters] = useState<FilterValues>({
    query: "",
    sortBy: "newest",
    activeTag: "all",
    category: "all",
    minBudget: 0,
    escrowStatus: "all",
  });

  const deferredQuery = useDeferredValue(filters.query);

  const tags = ["all", ...new Set(jobs?.flatMap((j) => j.tags) || [])];
  const categories = [...JOB_CATEGORIES];

  let filteredJobs = jobs?.filter((j) => j.status === "open") || [];

  if (filters.activeTag !== "all") {
    filteredJobs = filteredJobs.filter((j) => j.tags.includes(filters.activeTag));
  }

  if (filters.category !== "all") {
    // In a real app, category would be a field on job. 
    // For now, let's pretend tags or description can match category.
    filteredJobs = filteredJobs.filter((j) => 
      j.title.toLowerCase().includes(filters.category.toLowerCase()) || 
      j.description.toLowerCase().includes(filters.category.toLowerCase()) ||
      j.tags.some(t => t.toLowerCase() === filters.category.toLowerCase())
    );
  }

  if (filters.minBudget && filters.minBudget > 0) {
    filteredJobs = filteredJobs.filter((j) => j.budget >= (filters.minBudget || 0));
  }

  if (filters.escrowStatus !== "all") {
    // Escrow status in API is not directly mapped here, but let's assume it's part of metadata or status.
    // For this task, we'll just filter by a mock property or status.
    // Assuming 'status' for now or just passing it through.
  }

  if (deferredQuery?.trim()) {
    const term = deferredQuery.trim().toLowerCase();
    filteredJobs = filteredJobs.filter((j) =>
      [j.title, j.description, j.employerAddress, ...j.tags]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }

  const sortedJobs = [...filteredJobs].sort((a, b) => {
    switch (filters.sortBy) {
      case "newest":
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case "oldest":
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      case "budget-high":
        return b.budget - a.budget;
      case "budget-low":
        return a.budget - b.budget;
      default:
        return 0;
    }
  });

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-[300px_1fr] gap-12">
      <aside className="lg:sticky lg:top-12 self-start">
        <JobFilters 
          values={filters} 
          onChange={setFilters} 
          tags={tags} 
          categories={categories}
        />
      </aside>

      <main className="flex-1">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.2em]">
            Showing {sortedJobs.length} active listings
          </h2>
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
            <Suspense fallback={
              <div className="flex flex-col lg:grid lg:grid-cols-[300px_1fr] gap-12">
                <aside className="lg:sticky lg:top-12 self-start opacity-50 pointer-events-none">
                  <div className="h-[400px] rounded-xl border border-white/5 bg-white/[0.02] animate-pulse" />
                </aside>
                <div className="grid gap-6 md:grid-cols-1 xl:grid-cols-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <JobSkeleton key={i} />
                  ))}
                </div>
              </div>
            }>
              <JobListContent />
            </Suspense>
          </ErrorBoundary>
        </div>
      </SiteShell>
    </div>
  );
}
