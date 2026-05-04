"use client";

import Link from "next/link";
import { ArrowUpRight, Clock3, Star, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatUsdc, shortenAddress } from "@/lib/format";

export interface JobCardProps {
  job: JobCardData;
}

export interface JobCardData {
  id: string;
  title: string;
  description: string;
  budget_usdc: number;
  milestones: number;
  client_address: string;
  tags: string[];
  deadlineAt: string;
  clientReputation: ReputationMetrics;
  status: "open" | "in_progress" | "completed" | "disputed";
  created_at?: string;
}

interface ReputationMetrics {
  scoreBps: number;
  totalJobs: number;
  starRating: number;
  averageStars: number;
}

type JobStatusConfig = {
  label: string;
  color: {
    bg: string;
    text: string;
    border: string;
  };
};

const STATUS_CONFIG: Record<string, JobStatusConfig> = {
  open: {
    label: "Open",
    color: {
      bg: "bg-emerald-500/10",
      text: "text-emerald-500",
      border: "border-emerald-500/30",
    },
  },
  in_progress: {
    label: "In Progress",
    color: {
      bg: "bg-amber-500/10",
      text: "text-amber-500",
      border: "border-amber-500/30",
    },
  },
  completed: {
    label: "Completed",
    color: {
      bg: "bg-blue-500/10",
      text: "text-blue-500",
      border: "border-blue-500/30",
    },
  },
  disputed: {
    label: "Disputed",
    color: {
      bg: "bg-red-500/10",
      text: "text-red-500",
      border: "border-red-500/30",
    },
  },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.open;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em]",
        config.color.bg,
        config.color.text,
      )}
    >
      {config.label}
    </span>
  );
}

function StarRating({ rating }: { rating: number }) {
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 >= 0.5;

  return (
    <div className="flex items-center gap-0.5" role="img" aria-label={`${rating.toFixed(1)} stars`}>
      {Array.from({ length: 5 }, (_, i) => {
        const isFilled = i < fullStars || (i === fullStars && hasHalfStar);
        return (
          <Star
            key={i}
            className={cn(
              "h-3.5 w-3.5",
              isFilled
                ? "fill-amber-400 text-amber-400"
                : "fill-zinc-800 text-zinc-700",
            )}
          />
        );
      })}
    </div>
  );
}

export function JobCard({ job }: JobCardProps) {
  return (
    <article className="group relative flex flex-col rounded-3xl border border-white/10 bg-zinc-950/70 p-6 shadow-[0_20px_60px_-45px_rgba(15,23,42,0.55)] backdrop-blur-md transition-all duration-150 hover:-translate-y-1 hover:border-amber-500/30 hover:shadow-[0_24px_64px_-40px_rgba(15,23,42,0.65)] focus-within:ring-2 focus-within:ring-amber-500/50 focus-within:ring-offset-2 focus-within:ring-offset-zinc-950">
      <Link
        href={`/jobs/${job.id}`}
        className="absolute inset-0 rounded-3xl focus:outline-none"
        aria-label={`View job: ${job.title}`}
      >
        <span className="sr-only">View job details</span>
      </Link>

      <header className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <StatusBadge status={job.status} />
          <h2 className="text-xl font-semibold tracking-tight text-zinc-50">
            {job.title}
          </h2>
        </div>
        <ArrowUpRight
          className="h-5 w-5 text-zinc-500 transition-transform duration-150 group-hover:text-amber-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          aria-hidden="true"
        />
      </header>

      <p className="mt-4 line-clamp-3 text-sm leading-6 text-zinc-400">
        {job.description}
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {job.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-zinc-800/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-6 grid gap-4 rounded-2xl border border-white/10 bg-zinc-900/60 p-4 sm:grid-cols-3">
        <dl>
          <dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">
            Budget
          </dt>
          <dd className="mt-2 text-lg font-semibold text-zinc-100">
            {formatUsdc(job.budget_usdc)}
          </dd>
        </dl>
        <dl>
          <dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">
            Deadline
          </dt>
          <dd className="mt-2 flex items-center gap-2 text-sm font-medium text-zinc-300">
            <Clock3 className="h-4 w-4 text-amber-500" aria-hidden="true" />
            {formatDate(job.deadlineAt)}
          </dd>
        </dl>
        <dl>
          <dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">
            Milestones
          </dt>
          <dd className="mt-2 flex items-center gap-2 text-sm font-medium text-zinc-300">
            <Users className="h-4 w-4 text-zinc-500" aria-hidden="true" />
            {job.milestones} tracked
          </dd>
        </dl>
      </div>

      <footer className="mt-5 flex items-center justify-between gap-4 border-t border-white/10 pt-5">
        <dl>
          <dt className="text-xs uppercase tracking-[0.2em] text-zinc-500">
            Client
          </dt>
          <dd className="mt-1 text-sm font-medium text-zinc-300">
            {shortenAddress(job.client_address)}
          </dd>
        </dl>
        <div className="text-right">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-2">
            <StarRating rating={job.clientReputation.starRating} />
            <span className="text-sm font-semibold text-amber-400">
              {job.clientReputation.averageStars.toFixed(1)}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {job.clientReputation.totalJobs} jobs on-chain
          </p>
        </div>
      </footer>
    </article>
  );
}

export function JobCardSkeleton() {
  return (
    <article
      aria-hidden="true"
      className="animate-pulse rounded-3xl border border-white/10 bg-zinc-950/70 p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="h-6 w-20 rounded-full bg-zinc-800" />
          <div className="h-8 w-48 rounded-lg bg-zinc-800" />
        </div>
      </div>

      <div className="mt-5 space-y-2">
        <div className="h-4 w-full rounded bg-zinc-800" />
        <div className="h-4 w-[94%] rounded bg-zinc-800" />
        <div className="h-4 w-[68%] rounded bg-zinc-800" />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <div className="h-7 w-20 rounded-full bg-zinc-800" />
        <div className="h-7 w-24 rounded-full bg-zinc-800" />
        <div className="h-7 w-16 rounded-full bg-zinc-800" />
      </div>

      <div className="mt-6 grid gap-4 rounded-2xl border border-white/10 bg-zinc-900/60 p-4 sm:grid-cols-3">
        <div className="h-14 rounded bg-zinc-800" />
        <div className="h-14 rounded bg-zinc-800" />
        <div className="h-14 rounded bg-zinc-800" />
      </div>

      <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/10 pt-5">
        <div className="space-y-2">
          <div className="h-3 w-16 rounded bg-zinc-800" />
          <div className="h-4 w-24 rounded bg-zinc-800" />
        </div>
        <div className="space-y-2">
          <div className="h-8 w-20 rounded-full bg-zinc-800" />
          <div className="h-3 w-28 rounded bg-zinc-800" />
        </div>
      </div>
    </article>
  );
}