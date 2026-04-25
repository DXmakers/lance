"use client";

/**
 * ProjectCard - Individual project/contract display card
 * 
 * Features:
 * - Project name and client address
 * - Status badge with high-contrast colors
 * - Milestone progress bar
 * - Interactive hover effects
 */

import { ExternalLink, Calendar } from "lucide-react";
import { GlassCard } from "./glass-card";
import { StatusBadge, BadgeStatus } from "./status-badge";
import { CopyAddressButton } from "./copy-address-button";
import { ProgressBar } from "./progress-bar";

export interface ProjectData {
  id: string;
  name: string;
  clientAddress: string;
  status: BadgeStatus;
  milestonesCompleted: number;
  totalMilestones: number;
  budget: number;
  deadline?: string;
  currency?: string;
}

export interface ProjectCardProps {
  project: ProjectData;
  onViewDetails?: (projectId: string) => void;
  className?: string;
}

export function ProjectCard({
  project,
  onViewDetails,
  className = "",
}: ProjectCardProps) {
  const {
    id,
    name,
    clientAddress,
    status,
    milestonesCompleted,
    totalMilestones,
    budget,
    deadline,
    currency = "USDC",
  } = project;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <GlassCard
      interactive={!!onViewDetails}
      onClick={() => onViewDetails?.(id)}
      className={`animate-fade-in ${className}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-zinc-100 font-semibold text-lg mb-1 truncate">
            {name}
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-zinc-500 text-xs">Client:</span>
            <CopyAddressButton
              address={clientAddress}
              truncateLength={6}
              showFullOnHover
            />
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-zinc-400 text-sm">Milestones</span>
          <span className="text-financial text-sm text-zinc-300">
            {milestonesCompleted} / {totalMilestones}
          </span>
        </div>
        <ProgressBar
          value={milestonesCompleted}
          max={totalMilestones}
          size="md"
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 border-t border-zinc-800">
        <div className="flex items-center gap-4">
          {/* Budget */}
          <div>
            <span className="text-zinc-500 text-xs block mb-0.5">Budget</span>
            <div className="flex items-baseline gap-1">
              <span className="text-financial text-lg text-emerald-400">
                {formatCurrency(budget)}
              </span>
              <span className="text-zinc-500 text-xs">{currency}</span>
            </div>
          </div>

          {/* Deadline */}
          {deadline && (
            <div>
              <span className="text-zinc-500 text-xs block mb-0.5">Deadline</span>
              <div className="flex items-center gap-1 text-zinc-300">
                <Calendar className="h-3 w-3" />
                <span className="text-xs">{formatDate(deadline)}</span>
              </div>
            </div>
          )}
        </div>

        {/* View Details */}
        {onViewDetails && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewDetails(id);
            }}
            className="copy-button"
            aria-label="View project details"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        )}
      </div>
    </GlassCard>
  );
}
