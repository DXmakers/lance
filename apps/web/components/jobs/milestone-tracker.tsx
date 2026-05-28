"use client";

/**
 * MilestoneTracker — World-class Web3 milestone progress component
 *
 * Design system:
 *  - Zinc-950 background with glassmorphism overlays
 *  - 8px/4px spacing grid, 12px rounded corners
 *  - 150ms micro-interactions
 *  - Emerald-500 for released, Amber-500 for pending, Red-500 for disputed
 *  - Inter/Geist sans-serif with varied weights for hierarchy
 */

import { useMemo } from "react";
import {
  CheckCircle2,
  Circle,
  Clock3,
  Coins,
  Hash,
  Link2,
  LoaderCircle,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { type Milestone, type Deliverable } from "@/lib/api";
import { formatUsdc, formatDateTime, shortenAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MilestoneStatus = "pending" | "released" | "disputed" | string;

interface MilestoneTrackerProps {
  milestones: Milestone[];
  deliverables?: Deliverable[];
  jobStatus?: string;
  loading?: boolean;
  /** Whether the current viewer is the client (shows release controls) */
  isClient?: boolean;
  /** Whether the workflow is locked due to an active dispute */
  workflowLocked?: boolean;
  busyMilestoneId?: string | null;
  onRelease?: (milestoneId: string) => void;
}

// ── Status config ─────────────────────────────────────────────────────────────

interface StatusConfig {
  label: string;
  icon: React.ReactNode;
  /** Tailwind classes for the status pill */
  pill: string;
  /** Tailwind classes for the card border/glow */
  cardBorder: string;
  /** Tailwind classes for the timeline dot */
  dot: string;
  /** Tailwind classes for the connector line */
  connector: string;
}

function getStatusConfig(
  status: MilestoneStatus,
  hasDeliverable: boolean,
): StatusConfig {
  if (status === "released") {
    return {
      label: "Released",
      icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />,
      pill: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25 ring-emerald-500/10",
      cardBorder: "border-emerald-500/20 shadow-[0_0_0_1px_rgba(16,185,129,0.08),0_8px_32px_-8px_rgba(16,185,129,0.12)]",
      dot: "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]",
      connector: "bg-emerald-500/40",
    };
  }
  if (status === "disputed") {
    return {
      label: "Disputed",
      icon: <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />,
      pill: "bg-red-500/15 text-red-400 border-red-500/25 ring-red-500/10",
      cardBorder: "border-red-500/20 shadow-[0_0_0_1px_rgba(239,68,68,0.08),0_8px_32px_-8px_rgba(239,68,68,0.12)]",
      dot: "bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)]",
      connector: "bg-red-500/30",
    };
  }
  if (hasDeliverable) {
    return {
      label: "Under Review",
      icon: <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />,
      pill: "bg-sky-500/15 text-sky-400 border-sky-500/25 ring-sky-500/10",
      cardBorder: "border-sky-500/20 shadow-[0_0_0_1px_rgba(14,165,233,0.08),0_8px_32px_-8px_rgba(14,165,233,0.12)]",
      dot: "bg-sky-400 shadow-[0_0_12px_rgba(14,165,233,0.4)] animate-pulse",
      connector: "bg-sky-500/30",
    };
  }
  return {
    label: "Pending",
    icon: <Circle className="h-3.5 w-3.5" aria-hidden="true" />,
    pill: "bg-amber-500/12 text-amber-400 border-amber-500/20 ring-amber-500/8",
    cardBorder: "border-zinc-700/50",
    dot: "bg-zinc-600 border-2 border-zinc-500",
    connector: "bg-zinc-700/60",
  };
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({
  released,
  total,
}: {
  released: number;
  total: number;
}) {
  const pct = total === 0 ? 0 : Math.round((released / total) * 100);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Progress
        </span>
        <span className="text-[11px] font-semibold tabular-nums text-zinc-400">
          {released}/{total} released
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct}% of milestones released`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Summary stats ─────────────────────────────────────────────────────────────

function SummaryStats({
  milestones,
  releasedAmount,
}: {
  milestones: Milestone[];
  releasedAmount: number;
}) {
  const released = milestones.filter((m) => m.status === "released").length;
  const pending = milestones.filter((m) => m.status === "pending").length;

  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="rounded-xl bg-zinc-900/60 px-3 py-2.5 text-center ring-1 ring-zinc-800/80">
        <p className="text-lg font-semibold tabular-nums text-emerald-400">{released}</p>
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          Released
        </p>
      </div>
      <div className="rounded-xl bg-zinc-900/60 px-3 py-2.5 text-center ring-1 ring-zinc-800/80">
        <p className="text-lg font-semibold tabular-nums text-amber-400">{pending}</p>
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          Pending
        </p>
      </div>
      <div className="rounded-xl bg-zinc-900/60 px-3 py-2.5 text-center ring-1 ring-zinc-800/80">
        <p className="text-[13px] font-semibold tabular-nums text-zinc-200">
          {formatUsdc(releasedAmount)}
        </p>
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          Paid out
        </p>
      </div>
    </div>
  );
}

// ── Milestone card ────────────────────────────────────────────────────────────

interface MilestoneCardProps {
  milestone: Milestone;
  deliverables: Deliverable[];
  isLast: boolean;
  isClient: boolean;
  workflowLocked: boolean;
  isBusy: boolean;
  jobStatus: string;
  onRelease?: (id: string) => void;
}

function MilestoneCard({
  milestone,
  deliverables,
  isLast,
  isClient,
  workflowLocked,
  isBusy,
  jobStatus,
  onRelease,
}: MilestoneCardProps) {
  const milestoneDeliverables = deliverables.filter(
    (d) => d.milestone_index === milestone.index,
  );
  const hasDeliverable = milestoneDeliverables.length > 0;
  const config = getStatusConfig(milestone.status, hasDeliverable);

  const canRelease =
    isClient &&
    !workflowLocked &&
    milestone.status === "pending" &&
    hasDeliverable &&
    jobStatus === "deliverable_submitted";

  return (
    <div className="relative flex gap-4">
      {/* Timeline spine */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ring-4 ring-zinc-950 transition-all duration-150",
            config.dot,
          )}
          aria-hidden="true"
        >
          <span className="text-[10px] font-bold text-white">
            {milestone.index}
          </span>
        </div>
        {!isLast && (
          <div
            className={cn(
              "mt-1 w-0.5 flex-1 rounded-full transition-colors duration-300",
              config.connector,
            )}
            style={{ minHeight: "2rem" }}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Card */}
      <div
        className={cn(
          "mb-4 flex-1 rounded-xl border bg-zinc-900/50 p-4 backdrop-blur-sm transition-all duration-150",
          config.cardBorder,
        )}
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ring-1 transition-all duration-150",
                  config.pill,
                )}
              >
                {config.icon}
                {config.label}
              </span>
              {hasDeliverable && milestone.status === "pending" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-400 ring-1 ring-sky-500/20">
                  <TrendingUp className="h-3 w-3" aria-hidden="true" />
                  Deliverable submitted
                </span>
              )}
            </div>
            <p className="mt-2 text-sm font-semibold leading-snug text-zinc-100">
              {milestone.title}
            </p>
          </div>

          {/* Amount */}
          <div className="flex-shrink-0 text-right">
            <div className="flex items-center gap-1.5 text-sm font-bold tabular-nums text-zinc-100">
              <Coins className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              {formatUsdc(milestone.amount_usdc)}
            </div>
          </div>
        </div>

        {/* Metadata row */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {milestone.released_at && (
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" aria-hidden="true" />
              Released {formatDateTime(milestone.released_at)}
            </span>
          )}
          {milestone.tx_hash && (
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${milestone.tx_hash}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-[11px] text-zinc-500 transition-colors duration-150 hover:text-zinc-300"
              aria-label={`View transaction ${milestone.tx_hash} on Stellar Explorer`}
            >
              <Hash className="h-3 w-3" aria-hidden="true" />
              {shortenAddress(milestone.tx_hash)}
              <Link2 className="h-2.5 w-2.5" aria-hidden="true" />
            </a>
          )}
        </div>

        {/* Deliverables list */}
        {milestoneDeliverables.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Evidence ({milestoneDeliverables.length})
            </p>
            {milestoneDeliverables.map((d) => (
              <a
                key={d.id}
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-lg bg-zinc-800/60 px-3 py-2 text-[12px] text-zinc-400 ring-1 ring-zinc-700/50 transition-all duration-150 hover:bg-zinc-800 hover:text-zinc-200 hover:ring-zinc-600/60"
              >
                <Link2 className="h-3 w-3 flex-shrink-0 text-amber-500" aria-hidden="true" />
                <span className="truncate">{d.label}</span>
                <span className="ml-auto flex-shrink-0 text-[10px] text-zinc-600">
                  {formatDateTime(d.created_at)}
                </span>
              </a>
            ))}
          </div>
        )}

        {/* Release action */}
        {canRelease && (
          <div className="mt-4 border-t border-zinc-800/60 pt-4">
            <button
              type="button"
              onClick={() => onRelease?.(milestone.id)}
              disabled={isBusy}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-150",
                "bg-emerald-500 text-white hover:bg-emerald-400 active:scale-[0.98]",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
              )}
              aria-label={`Release funds for milestone ${milestone.index}: ${milestone.title}`}
            >
              {isBusy ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              )}
              {isBusy ? "Releasing…" : "Approve & Release Funds"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function MilestoneEmpty() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800/80 ring-1 ring-zinc-700/60">
        <TrendingUp className="h-5 w-5 text-zinc-500" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-zinc-400">No milestones yet</p>
      <p className="max-w-xs text-[12px] leading-5 text-zinc-600">
        Milestones are created when the client funds the escrow contract.
      </p>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function MilestoneTrackerSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading milestones…"
      className="space-y-4"
    >
      {[1, 2, 3].map((n) => (
        <div key={n} className="flex gap-4">
          <div className="flex flex-col items-center">
            <div className="h-8 w-8 animate-pulse rounded-full bg-zinc-800" />
            {n < 3 && <div className="mt-1 w-0.5 flex-1 animate-pulse rounded-full bg-zinc-800/60" style={{ minHeight: "2rem" }} />}
          </div>
          <div className="mb-4 flex-1 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="h-5 w-20 rounded-full bg-zinc-800" />
                <div className="h-4 w-48 rounded-full bg-zinc-800" />
              </div>
              <div className="h-4 w-16 rounded-full bg-zinc-800" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MilestoneTracker({
  milestones,
  deliverables = [],
  jobStatus = "",
  loading = false,
  isClient = false,
  workflowLocked = false,
  busyMilestoneId = null,
  onRelease,
}: MilestoneTrackerProps) {
  const { releasedAmount } = useMemo(() => {
    const released = milestones
      .filter((m) => m.status === "released")
      .reduce((sum, m) => sum + m.amount_usdc, 0);
    return { releasedAmount: released };
  }, [milestones]);

  const releasedCount = milestones.filter((m) => m.status === "released").length;

  return (
    <section
      aria-label="Milestone tracker"
      className="rounded-2xl border border-zinc-800/70 bg-zinc-950/80 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_24px_64px_-24px_rgba(0,0,0,0.6)] backdrop-blur-md"
    >
      {/* Header */}
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-zinc-100">
            Milestone Ledger
          </h2>
          <p className="mt-0.5 text-[12px] leading-5 text-zinc-500">
            Immutable on-chain payment checkpoints
          </p>
        </div>
        {loading && (
          <LoaderCircle
            className="h-4 w-4 animate-spin text-zinc-600"
            aria-label="Refreshing milestones"
          />
        )}
      </div>

      {/* Progress + stats */}
      {milestones.length > 0 && (
        <div className="mb-5 space-y-3">
          <ProgressBar released={releasedCount} total={milestones.length} />
          <SummaryStats
            milestones={milestones}
            releasedAmount={releasedAmount}
          />
        </div>
      )}

      {/* Divider */}
      {milestones.length > 0 && (
        <div className="mb-5 h-px bg-zinc-800/60" aria-hidden="true" />
      )}

      {/* Milestone list */}
      {loading && milestones.length === 0 ? (
        <MilestoneTrackerSkeleton />
      ) : milestones.length === 0 ? (
        <MilestoneEmpty />
      ) : (
        <div role="list" aria-label="Milestones">
          {milestones.map((milestone, idx) => (
            <div key={milestone.id} role="listitem">
              <MilestoneCard
                milestone={milestone}
                deliverables={deliverables}
                isLast={idx === milestones.length - 1}
                isClient={isClient}
                workflowLocked={workflowLocked}
                isBusy={busyMilestoneId === milestone.id}
                jobStatus={jobStatus}
                onRelease={onRelease}
              />
            </div>
          ))}
        </div>
      )}

      {/* Locked overlay notice */}
      {workflowLocked && milestones.length > 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-3">
          <ShieldAlert
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400"
            aria-hidden="true"
          />
          <p className="text-[12px] leading-5 text-red-400">
            Milestone releases are frozen while a dispute is active. Funds will
            be distributed per the Agent Judge verdict.
          </p>
        </div>
      )}
    </section>
  );
}
