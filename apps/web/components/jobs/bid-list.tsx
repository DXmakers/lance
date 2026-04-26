"use client";

import { useState } from "react";
import { CheckCircle2, Clock3, Loader2, UserCircle2 } from "lucide-react";
import { type Bid } from "@/lib/api";
import { shortenAddress, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

// ── Status helpers ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  pending: {
    label: "Pending",
    className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  },
  accepted: {
    label: "Accepted",
    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
  rejected: {
    label: "Rejected",
    className: "bg-red-500/10 text-red-400 border-red-500/20",
  },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    className: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  };
  return (
    <Badge
      variant="outline"
      className={cn("rounded-full text-[11px] font-medium capitalize", config.className)}
    >
      {config.label}
    </Badge>
  );
}

// ── Empty / loading states ──────────────────────────────────────────────────

function BidListSkeleton() {
  return (
    <ul aria-busy="true" aria-label="Loading bids…" className="space-y-3">
      {[1, 2, 3].map((n) => (
        <li
          key={n}
          className="animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="h-4 w-32 rounded-full bg-zinc-800" />
            <div className="h-5 w-16 rounded-full bg-zinc-800" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-full rounded-full bg-zinc-800" />
            <div className="h-3 w-4/5 rounded-full bg-zinc-800" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyBids() {
  return (
    <EmptyState
      icon={<Clock3 className="h-5 w-5" aria-hidden="true" />}
      title="No bids yet"
      description="Freelancers who apply will appear here."
      tone="dark"
    />
  );
}

// ── Main component ──────────────────────────────────────────────────────────

interface BidListProps {
  bids: Bid[];
  loading?: boolean;
  error?: string | null;
  isClientOwner?: boolean;
  jobStatus?: string;
  acceptingBidId?: string | null;
  onAccept?: (bidId: string) => void;
}

/**
 * BidList — Issue #132
 *
 * Renders the list of bids on a job from the client's perspective.
 * - Shows loading skeletons while bids are being fetched
 * - Empty state when no bids have been submitted
 * - Error boundary fallback for fetch failures
 * - Per-bid "Accept" action for the client owner on open jobs
 * - Status badges with semantic colour coding (Amber = pending, Emerald = accepted)
 * - Fully responsive with keyboard-accessible accept buttons
 */
export function BidList({
  bids,
  loading = false,
  error = null,
  isClientOwner = false,
  jobStatus = "open",
  acceptingBidId = null,
  onAccept,
}: BidListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) return <BidListSkeleton />;

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-[12px] border border-red-500/20 bg-red-500/5 p-5 text-xs font-medium text-red-400"
      >
        {error}
      </div>
    );
  }

  if (bids.length === 0) return <EmptyBids />;

  const canAccept = isClientOwner && jobStatus === "open";

  return (
    <ul aria-label="Bids" className="space-y-4">
      {bids.map((bid) => {
        const isExpanded = expandedId === bid.id;
        const isAccepting = acceptingBidId === bid.id;
        const isAccepted = bid.status === "accepted";

        return (
          <li
            key={bid.id}
            className={cn(
              "rounded-[12px] border p-5 transition-all duration-150 ease-in-out",
              isAccepted
                ? "border-emerald-500/30 bg-emerald-500/5 shadow-[0_0_20px_-10px_rgba(16,185,129,0.2)]"
                : "border-zinc-800/50 bg-zinc-900/40 backdrop-blur-md hover:border-zinc-700/80 hover:bg-zinc-900/60",
            )}
          >
            {/* Header row */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800/80 border border-white/5">
                  <UserCircle2
                    className="h-4 w-4 text-zinc-400"
                    aria-hidden="true"
                  />
                </div>
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : bid.id)}
                    aria-expanded={isExpanded}
                    className="font-mono text-[13px] font-bold tracking-tight text-zinc-200 transition-colors hover:text-indigo-400"
                  >
                    {shortenAddress(bid.freelancer_address)}
                  </button>
                  <time
                    dateTime={bid.created_at}
                    className="text-[10px] font-medium uppercase tracking-widest text-zinc-600"
                  >
                    {formatDate(bid.created_at)}
                  </time>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <StatusBadge status={bid.status} />
              </div>
            </div>

            {/* Proposal */}
            <div
              id={`bid-proposal-${bid.id}`}
              className={cn(
                "mt-4 text-[13px] leading-relaxed text-zinc-400 font-medium",
                !isExpanded && "line-clamp-2",
              )}
            >
              {bid.proposal}
            </div>

            {bid.proposal.length > 120 && (
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : bid.id)}
                className="mt-2 text-[11px] font-bold text-indigo-400 transition-colors hover:text-indigo-300"
              >
                {isExpanded ? "Collapse brief" : "Expand brief"}
              </button>
            )}

            {/* Accept action */}
            {canAccept && !isAccepted && (
              <div className="mt-6 flex justify-end border-t border-white/5 pt-4">
                <button
                  onClick={() => onAccept?.(bid.id)}
                  disabled={isAccepting || Boolean(acceptingBidId)}
                  className="flex items-center gap-2 rounded-[12px] bg-emerald-600 px-5 py-2.5 text-[11px] font-bold text-white transition-all duration-150 hover:bg-emerald-500 hover:shadow-[0_0_20px_-5px_rgba(16,185,129,0.4)] disabled:opacity-50 active:scale-[0.98]"
                >
                  {isAccepting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      Accepting…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Accept Proposal
                    </>
                  )}
                </button>
              </div>
            )}

            {isAccepted && (
              <div className="mt-4 flex items-center gap-2 rounded-[8px] bg-emerald-500/5 px-3 py-2 border border-emerald-500/10">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                  Engagement Secured — Awaiting Funding
                </span>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
