"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, Clock, XCircle } from "lucide-react";

export type BidStatus = "pending" | "accepted" | "rejected";

interface BidStatusBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  status: BidStatus;
  animated?: boolean;
}

// ── Status configuration with semantic colors and icons ──────────────────────
const STATUS_CONFIG: Record<
  BidStatus,
  {
    color: string;
    backgroundColor: string;
    borderColor: string;
    icon: React.ReactNode;
    label: string;
    description: string;
  }
> = {
  pending: {
    color: "text-amber-500",
    backgroundColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
    icon: <Clock className="w-4 h-4" />,
    label: "Pending",
    description: "Awaiting client action",
  },
  accepted: {
    color: "text-emerald-500",
    backgroundColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
    icon: <CheckCircle2 className="w-4 h-4" />,
    label: "Accepted",
    description: "Bid selected for this job",
  },
  rejected: {
    color: "text-red-500",
    backgroundColor: "bg-red-500/10",
    borderColor: "border-red-500/20",
    icon: <XCircle className="w-4 h-4" />,
    label: "Rejected",
    description: "Bid declined by client",
  },
};

/**
 * BidStatusBadge Component
 *
 * Displays the current status of a bid with semantic color coding,
 * icons, and accessibility attributes. Supports pending, accepted,
 * and rejected states with smooth transitions.
 *
 * @param status - The bid status ('pending' | 'accepted' | 'rejected')
 * @param animated - Whether to apply animation effects (default: false)
 * @param className - Additional CSS classes to apply
 * @param props - Standard HTML div attributes
 *
 * @example
 * <BidStatusBadge status="pending" animated={true} />
 * <BidStatusBadge status="accepted" />
 */
export function BidStatusBadge({
  status,
  animated = false,
  className,
  ...props
}: BidStatusBadgeProps) {
  const config = STATUS_CONFIG[status];

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full border font-inter text-[13px] font-medium tracking-tight",
        "transition-all duration-150 ease-in-out",
        "backdrop-blur-sm shadow-sm",
        config.backgroundColor,
        config.borderColor,
        config.color,
        animated && "animate-pulse",
        className,
      )}
      role="status"
      aria-label={`Bid ${config.label}: ${config.description}`}
      {...props}
    >
      {config.icon}
      <span>{config.label}</span>
    </div>
  );
}

/**
 * BidStatusIndicator Component
 *
 * A more detailed status indicator showing both status badge and metadata.
 * Useful in detailed bid views where additional information is needed.
 *
 * @param status - The bid status
 * @param timestamp - Optional timestamp for status change
 * @param className - Additional CSS classes to apply
 */
interface BidStatusIndicatorProps extends React.HTMLAttributes<HTMLDivElement> {
  status: BidStatus;
  timestamp?: string;
}

export function BidStatusIndicator({
  status,
  timestamp,
  className,
  ...props
}: BidStatusIndicatorProps) {
  const config = STATUS_CONFIG[status];

  return (
    <div
      className={cn(
        "inline-flex flex-col gap-2 px-4 py-3 rounded-lg border",
        config.backgroundColor,
        config.borderColor,
        "transition-all duration-150 ease-in-out",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        <span className={cn("", config.color)}>{config.icon}</span>
        <span className={cn("text-sm font-medium", config.color)}>
          {config.label}
        </span>
      </div>
      {timestamp && (
        <p className="text-xs text-zinc-500">Updated {timestamp}</p>
      )}
    </div>
  );
}
