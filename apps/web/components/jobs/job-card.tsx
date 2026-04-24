"use client";

import Link from "next/link";
import { ArrowUpRight, Bookmark, Clock3 } from "lucide-react";
import { Stars } from "@/components/stars";
import { formatDate, formatUsdc, shortenAddress } from "@/lib/format";
import type { BoardJob } from "@/hooks/use-job-board";
import { useSavedJobsStore } from "@/lib/store/use-saved-jobs-store";
import { cn } from "@/lib/utils";

interface JobCardProps {
  job: BoardJob;
}

export function JobCard({ job }: JobCardProps) {
  const { toggleSaveJob, isSaved } = useSavedJobsStore();
  const saved = isSaved(job.id);

  return (
    <div className="group relative">
      <Link
        href={`/jobs/${job.id}`}
        className="block rounded-[1.75rem] border border-border/60 glass-surface p-6 shadow-[0_20px_60px_-45px_rgba(15,23,42,0.55)] transition hover:-translate-y-1 hover:border-amber-300 dark:hover:border-amber-500/50"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700 dark:text-amber-500">
              {job.status}
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-zinc-50">
              {job.title}
            </h2>
          </div>
          <ArrowUpRight className="h-5 w-5 text-slate-400 transition group-hover:text-slate-950 dark:group-hover:text-zinc-50" />
        </div>

        <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-600 dark:text-zinc-400">
          {job.description}
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          {job.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 dark:bg-zinc-800 dark:text-zinc-400"
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="mt-6 grid gap-4 rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3 dark:border-white/5 dark:bg-zinc-800/50">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400 dark:text-zinc-500">
              Budget
            </p>
            <p className="mt-2 text-lg font-semibold text-slate-950 dark:text-zinc-50">
              {formatUsdc(job.budget_usdc)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400 dark:text-zinc-500">
              Deadline
            </p>
            <p className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-zinc-300">
              <Clock3 className="h-4 w-4 text-amber-600 dark:text-amber-500" />
              {formatDate(job.deadlineAt)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400 dark:text-zinc-500">
              Milestones
            </p>
            <p className="mt-2 text-sm font-medium text-slate-700 dark:text-zinc-300">
              {job.milestones} tracked approvals
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400 dark:text-zinc-500">
              Client
            </p>
            <p className="mt-2 text-sm font-medium text-slate-700 dark:text-zinc-300">
              {shortenAddress(job.client_address)}
            </p>
          </div>
          <div className="text-right">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <Stars value={job.clientReputation.starRating} />
              {job.clientReputation.averageStars.toFixed(1)}
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-zinc-500">
              {job.clientReputation.totalJobs} completed jobs on-chain
            </p>
          </div>
        </div>
      </Link>

      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleSaveJob(job);
        }}
        className={cn(
          "absolute right-12 top-6 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:scale-110 active:scale-95 dark:border-white/10 dark:bg-zinc-800",
          saved
            ? "border-amber-500 bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-500"
            : "text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        )}
        aria-label={saved ? "Unsave job" : "Save job"}
      >
        <Bookmark
          className={cn("h-5 w-5", saved && "fill-current")}
        />
      </button>
    </div>
  );
}
