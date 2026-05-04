import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type JobStatus = "pending" | "success" | "rejected" | "completed" | "in_progress";

interface StatusBadgeProps {
  status: JobStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const statusConfig: Record<JobStatus, { label: string; bg: string }> = {
    pending: { label: "Pending", bg: "bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30" },
    success: { label: "Success", bg: "bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30" },
    completed: { label: "Completed", bg: "bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30" },
    rejected: { label: "Rejected", bg: "bg-red-500/20 text-red-500 hover:bg-red-500/30" },
    in_progress: { label: "In Progress", bg: "bg-blue-500/20 text-blue-500 hover:bg-blue-500/30" },
  };

  const config = statusConfig[status] || statusConfig.pending;

  return (
    <Badge variant="outline" className={cn("border-none capitalize font-medium rounded-full px-2.5 py-0.5 text-xs", config.bg, className)}>
      {config.label}
    </Badge>
  );
}
