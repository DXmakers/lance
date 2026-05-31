"use client";

/**
 * StatusBadge - High-contrast status indicator for Web3 dashboard
 * 
 * Uses strict color system:
 * - Emerald-500 for success/completion
 * - Amber-500 for pending/warning
 * - Red-500 for error/failed
 * - Blue-500 for info
 */

import { Circle, CheckCircle2, Clock, XCircle, Info } from "lucide-react";

export type BadgeStatus = "success" | "pending" | "error" | "info" | "active";

export interface StatusBadgeProps {
  status: BadgeStatus;
  label?: string;
  showIcon?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const statusConfig = {
  success: {
    icon: CheckCircle2,
    className: "badge-success",
    defaultLabel: "Completed",
  },
  pending: {
    icon: Clock,
    className: "badge-warning",
    defaultLabel: "Pending",
  },
  error: {
    icon: XCircle,
    className: "badge-error",
    defaultLabel: "Failed",
  },
  info: {
    icon: Info,
    className: "badge-info",
    defaultLabel: "Info",
  },
  active: {
    icon: Circle,
    className: "badge-success",
    defaultLabel: "Active",
  },
};

const sizeClasses = {
  sm: "text-[10px] px-2 py-0.5",
  md: "text-xs px-3 py-1",
  lg: "text-sm px-4 py-1.5",
};

export function StatusBadge({
  status,
  label,
  showIcon = true,
  size = "md",
  className = "",
}: StatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;
  const displayLabel = label || config.defaultLabel;

  return (
    <span
      className={`
        ${config.className}
        ${sizeClasses[size]}
        ${className}
      `}
    >
      {showIcon && <Icon className="h-3 w-3" />}
      <span>{displayLabel}</span>
    </span>
  );
}
