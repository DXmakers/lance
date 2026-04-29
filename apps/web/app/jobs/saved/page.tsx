"use client";

import { SiteShell } from "@/components/site-shell";
import { JobCard } from "@/components/jobs/job-card";
import { useSavedJobsStore } from "@/lib/store/use-saved-jobs-store";
import { Bookmark, Search } from "lucide-react";
import { useState } from "react";

export default function SavedJobsPage() {
  const { savedJobs } = useSavedJobsStore();
  const [query, setQuery] = useState("");

  const filteredJobs = savedJobs.filter((job) =>
    [job.title, job.description, ...job.tags]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase())
  );

  return (
    <SiteShell
      eyebrow="My Collection"
      title="Saved Opportunities"
      description="Keep track of high-signal briefs you want to bid on later. These jobs are stored locally for fast retrieval and persistence across sessions."
    >
      <section className="rounded-[2rem] border border-border/60 glass-surface p-5 shadow-[0_25px_80px_-50px_rgba(15,23,42,0.55)] sm:p-6">
        <label className="flex items-center gap-3 rounded-2xl border border-border/40 bg-background/40 px-4 py-3">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your saved jobs..."
            className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-zinc-50"
          />
        </label>
      </section>

      <section className="mt-8">
        {filteredJobs.length > 0 ? (
          <div className="grid gap-5 lg:grid-cols-2">
            {filteredJobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-[2rem] border border-dashed border-slate-300 bg-white/70 py-24 text-center dark:border-white/10 dark:bg-zinc-900/40">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-zinc-800 dark:text-zinc-500">
              <Bookmark className="h-8 w-8" />
            </div>
            <h3 className="mt-6 text-xl font-semibold text-slate-900 dark:text-zinc-100">
              No saved jobs yet
            </h3>
            <p className="mt-2 max-w-sm text-sm text-slate-500 dark:text-zinc-400">
              Browse the job registry and click the bookmark icon to keep track of interesting opportunities.
            </p>
          </div>
        )}
      </section>
    </SiteShell>
  );
}
