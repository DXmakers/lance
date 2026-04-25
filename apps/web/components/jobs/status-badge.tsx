"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CheckCircle2, Clock, XCircle } from "lucide-react";

export type JobStatus = "pending" | "success" | "failed";

interface StatusBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  status: JobStatus;
  label?: string;
}

export function StatusBadge({ status, label, className, ...props }: StatusBadgeProps) {
  const statusConfig = {
    pending: {
      color: "border-amber-500/30 bg-amber-500/10 text-amber-500",
      icon: <Clock className="w-3.5 h-3.5 mr-1.5" />,
      text: label || "Pending",
    },
    success: {
      color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
      icon: <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />,
      text: label || "Success",
    },
    failed: {
      color: "border-red-500/30 bg-red-500/10 text-red-500",
      icon: <XCircle className="w-3.5 h-3.5 mr-1.5" />,
      text: label || "Failed",
    },
  };

  const config = statusConfig[status];

  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-3 py-1 font-inter border shadow-sm backdrop-blur-sm transition-all duration-150",
        config.color,
        className
      )}
      {...props}
    >
      {config.icon}
      <span className="font-medium tracking-tight text-[13px]">{config.text}</span>
    </Badge>
  );
}
