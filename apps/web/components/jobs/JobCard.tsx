"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight, Clock3, Star } from "lucide-react";
import { BoardJob } from "@/hooks/job-queries";
import { formatDate, formatUsdc, shortenAddress } from "@/lib/format";

interface JobCardProps {
  job: BoardJob;
}

/**
 * JobCard component for the JobList.
 * Features Zinc-950 dark mode, glassmorphism, and WCAG compliant contrast.
 */
export const JobCard: React.FC<JobCardProps> = ({ job }) => {
  const statusColor = job.status === "open" ? "text-emerald-500" : "text-amber-500";
  const statusBg = job.status === "open" ? "bg-emerald-500/10 border-emerald-500/20" : "bg-amber-500/10 border-amber-500/20";

  return (
    <Link
      href={`/jobs/${job.id}`}
      className="group relative flex flex-col p-6 rounded-xl border border-zinc-800 bg-zinc-900/50 backdrop-blur-md transition-all duration-150 hover:border-zinc-700 hover:-translate-y-1 focus:ring-2 focus:ring-zinc-600 outline-none"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex flex-col gap-1">
          <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest border ${statusColor} ${statusBg}`}>
            {job.status}
          </span>
          <h3 className="mt-2 text-xl font-bold text-zinc-100 group-hover:text-emerald-400 transition-colors">
            {job.title}
          </h3>
        </div>
        <ArrowUpRight className="h-5 w-5 text-zinc-500 group-hover:text-zinc-100 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
      </div>

      <p className="text-sm text-zinc-400 line-clamp-2 mb-6 leading-relaxed">
        {job.description}
      </p>

      <div className="flex flex-wrap gap-2 mb-6">
        {job.tags.map((tag) => (
          <span key={tag} className="px-2 py-1 rounded-md bg-zinc-800/50 text-[10px] font-mono text-zinc-500 uppercase">
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-auto grid grid-cols-2 gap-4 p-4 rounded-lg bg-zinc-950/50 border border-zinc-800/50">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-zinc-500 uppercase tracking-tighter">Budget</span>
          <span className="text-sm font-bold text-zinc-200">{formatUsdc(job.budget_usdc)}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-zinc-500 uppercase tracking-tighter">Deadline</span>
          <div className="flex items-center gap-1.5 text-xs text-zinc-300">
            <Clock3 className="h-3 w-3 text-emerald-500" />
            {formatDate(job.deadlineAt)}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-zinc-600 uppercase">Client</span>
          <span className="text-xs font-mono text-zinc-400">{shortenAddress(job.client_address)}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-amber-500">
            <Star className="h-3 w-3 fill-current" />
            <span className="text-xs font-bold">{job.clientReputation.averageStars.toFixed(1)}</span>
          </div>
          <span className="text-[10px] text-zinc-600">({job.clientReputation.totalJobs} jobs)</span>
        </div>
      </div>
    </Link>
  );
};
