"use client";

import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiActivity } from "@/lib/api";
import type { ActivityLog } from "@/lib/api";
import { CheckCircle2, Clock, AlertCircle, Info, LucideIcon } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function simpleDistanceToNow(date: Date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface ActivityItemProps {
  activity: ActivityLog;
}

const LEVEL_CONFIG: Record<
  string,
  { icon: LucideIcon; color: string; bg: string; border: string }
> = {
  success: {
    icon: CheckCircle2,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
  pending: {
    icon: Clock,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  error: {
    icon: AlertCircle,
    color: "text-red-500",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
  },
  info: {
    icon: Info,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
  },
};

const ActivityItem = ({ activity }: ActivityItemProps) => {
  const config = LEVEL_CONFIG[activity.level] || LEVEL_CONFIG.info;
  const Icon = config.icon;

  const message = useMemo(() => {
    if (
      activity.details &&
      typeof activity.details === "object" &&
      "message" in activity.details
    ) {
      const msg = activity.details.message;
      return typeof msg === 'string' ? msg : JSON.stringify(msg);
    }
    if (typeof activity.details === "string") return activity.details;
    return activity.event_type.replace(/_/g, " ");
  }, [activity]);

  return (
    <article
      className={cn(
        "group flex items-start gap-4 p-4 rounded-xl",
        "bg-zinc-900/50 backdrop-blur-md border border-white/5",
        "hover:bg-zinc-900/80 hover:border-white/10 transition-all duration-150 ease-in-out",
      )}
      aria-labelledby={`activity-title-${activity.id}`}
    >
      <div
        className={cn(
          "flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg border",
          config.bg,
          config.border,
          config.color,
        )}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h4
            id={`activity-title-${activity.id}`}
            className="text-sm font-semibold text-zinc-100 truncate capitalize"
          >
            {activity.event_type.split(".").join(" ")}
          </h4>
          <time
            className="text-[10px] font-medium uppercase tracking-wider text-zinc-500"
            dateTime={activity.created_at}
          >
            {simpleDistanceToNow(new Date(activity.created_at))} ago
          </time>
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2">
          {message}
        </p>
      </div>
    </article>
  );
};

export function ActivityLogList({ jobId, userAddress }: { jobId?: string; userAddress?: string }) {
  const {
    data = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["activity", jobId, userAddress],
    queryFn: () => apiActivity.list({ jobId, userAddress, limit: 20 }),
    refetchInterval: 10000, // Refresh every 10s for "real-time" updates
  });

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 bg-zinc-900/50 rounded-xl border border-white/5" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-8 rounded-xl bg-red-500/5 border border-red-500/10 text-center">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <p className="text-sm font-medium text-red-400">Failed to sync activity</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 text-xs font-semibold text-zinc-100 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="p-12 rounded-xl bg-zinc-900/30 border border-white/5 border-dashed text-center">
        <div className="w-12 h-12 bg-zinc-900 rounded-full flex items-center justify-center mx-auto mb-4">
          <Info className="w-6 h-6 text-zinc-500" />
        </div>
        <p className="text-sm font-medium text-zinc-400">No activity recorded yet</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {data.map((activity) => (
        <ActivityItem key={activity.id} activity={activity} />
      ))}
    </div>
  );
}

export default ActivityLogList;

