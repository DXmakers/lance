"use client";

import { useState } from "react";
import { CheckCircle2, Clock3, Loader2, UserCircle2 } from "lucide-react";
import { type Bid } from "@/lib/api";
import { shortenAddress, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Status helpers ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  pending: {
    label: "Pending",
    className: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  },
  accepted: {
    label: "Accepted",
    className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  },
  rejected: {
    label: "Rejected",
    className: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
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
      className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider", config.className)}
    >
      {config.label}
    </Badge>
  );
}

// ── Empty / loading states ──────────────────────────────────────────────────

function BidListSkeleton() {
  return (
    <ul aria-busy="true" aria-label="Loading bids…" className="space-y-4">
      {[1, 2].map((n) => (
        <li
          key={n}
          className="animate-pulse rounded-xl border border-zinc-800/50 bg-zinc-900/40 p-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="h-4 w-32 rounded-lg bg-zinc-800" />
            <div className="h-5 w-16 rounded-lg bg-zinc-800" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-full rounded-lg bg-zinc-800" />
            <div className="h-3 w-4/5 rounded-lg bg-zinc-800" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyBids() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-zinc-800 py-10 text-center bg-zinc-950/20">
      <Clock3 className="h-8 w-8 text-zinc-700" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold text-zinc-300">No bids yet</p>
        <p className="mt-1 text-xs text-zinc-500">
          Opportunities are being scouted.
        </p>
      </div>
    </div>
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
        className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-xs font-medium text-red-400"
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
              "group relative overflow-hidden rounded-xl border p-4 transition-all duration-150 ease-out",
              isAccepted
                ? "border-emerald-500/30 bg-emerald-500/[0.03] shadow-[0_0_20px_-12px_rgba(16,185,129,0.3)]"
                : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900/60 shadow-lg shadow-black/20",
            )}
          >
            {/* Glassmorphism backdrop */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />

            {/* Header row */}
            <div className="relative flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                  <UserCircle2
                    className="h-4 w-4 text-zinc-400"
                    aria-hidden="true"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : bid.id)}
                  aria-expanded={isExpanded}
                  aria-controls={`bid-proposal-${bid.id}`}
                  className="font-mono text-xs font-semibold text-zinc-100 hover:text-white focus-visible:outline-none"
                >
                  {shortenAddress(bid.freelancer_address)}
                </button>
              </div>

              <div className="flex items-center gap-3">
                <StatusBadge status={bid.status} />
                <time
                  dateTime={bid.created_at}
                  className="text-[10px] font-medium uppercase tracking-tight text-zinc-600"
                >
                  {formatDate(bid.created_at)}
                </time>
              </div>
            </div>

            {/* Proposal */}
            <div
              id={`bid-proposal-${bid.id}`}
              className={cn(
                "relative mt-3 text-[13px] leading-relaxed text-zinc-400 transition-all duration-200",
                !isExpanded && "line-clamp-2",
              )}
            >
              {bid.proposal}
            </div>

            <div className="relative mt-4 flex items-center justify-between">
              {bid.proposal.length > 120 ? (
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : bid.id)}
                  className="text-[11px] font-bold text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {isExpanded ? "Collapse Brief" : "Read Full Proposal"}
                </button>
              ) : <div />}

              {/* Accept action */}
              {canAccept && !isAccepted && (
                <Button
                  size="sm"
                  onClick={() => onAccept?.(bid.id)}
                  disabled={isAccepting || Boolean(acceptingBidId)}
                  className="h-8 rounded-lg bg-emerald-500 px-4 text-[11px] font-bold text-zinc-950 shadow-[0_0_15px_-3px_rgba(16,185,129,0.5)] transition-all hover:bg-emerald-400 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                >
                  {isAccepting ? (
                    <>
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden="true" />
                      Processing
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="mr-1.5 h-3 w-3" aria-hidden="true" />
                      Accept Bid
                    </>
                  )}
                </Button>
              )}
            </div>

            {isAccepted && (
              <div className="relative mt-3 flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-[11px] font-bold text-emerald-500">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                Active Engagement Confirmed
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
