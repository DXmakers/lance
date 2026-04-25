/**
 * transaction-pipeline.tsx
 *
 * Visual Build → Simulate → Sign → Submit → Confirm progress tracker.
 *
 * - Monospace styling for hashes and XDR blobs
 * - Collapsible dev panel for raw XDR and simulation logs
 * - Accessible: uses role="status", aria-live, and aria-current
 * - Matches the project's zinc/indigo dark-mode design language
 */

"use client";

import { useState } from "react";
import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  ExternalLink,
  Loader2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineStep, SimulationLog } from "@/lib/soroban-pipeline";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransactionPipelineProps {
  step: PipelineStep;
  txHash?: string | null;
  message?: string;
  error?: string | null;
  /** Dev-only: unsigned XDR */
  unsignedXdr?: string | null;
  /** Dev-only: signed XDR */
  signedXdr?: string | null;
  /** Dev-only: simulation diagnostics */
  simulationLog?: SimulationLog | null;
  className?: string;
}

// ─── Step definitions ─────────────────────────────────────────────────────────

const PIPELINE_STEPS: Array<{
  id: PipelineStep;
  label: string;
  description: string;
}> = [
  {
    id: "building",
    label: "Build",
    description: "Construct transaction with Contract.call()",
  },
  {
    id: "simulating",
    label: "Simulate",
    description: "Preflight on Soroban RPC — set resource limits & fees",
  },
  {
    id: "signing",
    label: "Sign",
    description: "Wallet signs the prepared XDR",
  },
  {
    id: "submitting",
    label: "Submit",
    description: "Broadcast signed XDR to Testnet RPC",
  },
  {
    id: "confirming",
    label: "Confirm",
    description: "Poll ledgers until final state",
  },
];

const STEP_ORDER: PipelineStep[] = [
  "idle",
  "building",
  "simulating",
  "signing",
  "submitting",
  "confirming",
  "success",
];

function stepIndex(step: PipelineStep): number {
  return STEP_ORDER.indexOf(step);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface StepIconProps {
  status: "pending" | "active" | "done" | "error";
}

function StepIcon({ status }: StepIconProps) {
  if (status === "done") {
    return (
      <CheckCircle
        className="h-5 w-5 text-emerald-400"
        aria-hidden="true"
      />
    );
  }
  if (status === "active") {
    return (
      <Loader2
        className="h-5 w-5 animate-spin text-indigo-400"
        aria-hidden="true"
      />
    );
  }
  if (status === "error") {
    return (
      <XCircle className="h-5 w-5 text-red-400" aria-hidden="true" />
    );
  }
  return (
    <CircleDashed
      className="h-5 w-5 text-zinc-600"
      aria-hidden="true"
    />
  );
}

interface HashDisplayProps {
  label: string;
  value: string;
  explorerUrl?: string;
}

function HashDisplay({ label, value, explorerUrl }: HashDisplayProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-2 space-y-1">
      <p className="text-[10px] uppercase tracking-widest text-zinc-500">
        {label}
      </p>
      <div className="flex items-center gap-2 rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-2">
        <code className="flex-1 break-all font-mono text-[11px] text-zinc-300">
          {value}
        </code>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label={`Copy ${label}`}
            className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View ${label} on Stellar Explorer`}
              className="rounded p-0.5 text-zinc-500 transition-colors hover:text-indigo-400"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

interface SimLogPanelProps {
  log: SimulationLog;
}

function SimLogPanel({ log }: SimLogPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 rounded-lg border border-zinc-700/50 bg-zinc-900/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-zinc-400 transition-colors hover:text-zinc-200"
      >
        <span className="font-mono uppercase tracking-widest text-[10px]">
          Simulation Log
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="border-t border-zinc-700/50 px-3 pb-3 pt-2">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
            <SimLogRow label="CPU Instructions" value={log.cpuInsns} />
            <SimLogRow label="Memory Bytes" value={log.memBytes} />
            <SimLogRow label="Min Resource Fee" value={`${log.minResourceFee} stroops`} />
            <SimLogRow label="Read Bytes" value={String(log.readBytes)} />
            <SimLogRow label="Write Bytes" value={String(log.writeBytes)} />
          </dl>
        </div>
      )}
    </div>
  );
}

function SimLogRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-mono text-zinc-300">{value}</dd>
    </>
  );
}

interface XdrPanelProps {
  label: string;
  xdr: string;
}

function XdrPanel({ label, xdr }: XdrPanelProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(xdr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-2 rounded-lg border border-zinc-700/50 bg-zinc-900/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:text-zinc-200"
      >
        <span className="font-mono uppercase tracking-widest text-[10px] text-zinc-400">
          {label}
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="border-t border-zinc-700/50 px-3 pb-3 pt-2">
          <div className="flex items-start justify-between gap-2">
            <code className="flex-1 break-all font-mono text-[10px] leading-relaxed text-zinc-400">
              {xdr}
            </code>
            <button
              type="button"
              onClick={() => void handleCopy()}
              aria-label={`Copy ${label}`}
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const EXPLORER_BASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "PUBLIC"
    ? "https://stellar.expert/explorer/public/tx"
    : "https://stellar.expert/explorer/testnet/tx";

export function TransactionPipeline({
  step,
  txHash,
  message,
  error,
  unsignedXdr,
  signedXdr,
  simulationLog,
  className,
}: TransactionPipelineProps) {
  const currentIndex = stepIndex(step);
  const isError = step === "error";
  const isSuccess = step === "success";
  const isIdle = step === "idle";
  const isDev = process.env.NODE_ENV !== "production";

  if (isIdle) return null;

  return (
    <section
      role="status"
      aria-live="polite"
      aria-label="Transaction pipeline progress"
      className={cn(
        "rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5 shadow-[0_20px_60px_-40px_rgba(79,70,229,0.5)] backdrop-blur-sm",
        className,
      )}
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.18em] text-indigo-300">
          Transaction Pipeline
        </p>
        {isSuccess && (
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-400">
            Confirmed
          </span>
        )}
        {isError && (
          <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-red-400">
            Failed
          </span>
        )}
      </div>

      {/* Step list */}
      <ol className="space-y-3" aria-label="Pipeline steps">
        {PIPELINE_STEPS.map((pipelineStep, idx) => {
          const pipelineStepIndex = idx + 1; // building=1, simulating=2, …
          const isDone =
            isSuccess ||
            (!isError && currentIndex > pipelineStepIndex);
          const isActive =
            !isSuccess &&
            !isError &&
            currentIndex === pipelineStepIndex;
          const isStepError =
            isError && currentIndex === pipelineStepIndex;
          const isPending = !isDone && !isActive && !isStepError;

          const status = isStepError
            ? "error"
            : isDone
              ? "done"
              : isActive
                ? "active"
                : "pending";

          return (
            <li
              key={pipelineStep.id}
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors duration-200",
                isActive && "bg-indigo-500/10",
                isDone && "opacity-70",
                isPending && "opacity-40",
                isStepError && "bg-red-500/10",
              )}
            >
              <div className="mt-0.5 shrink-0">
                <StepIcon status={status} />
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-semibold",
                    isDone && "text-zinc-300",
                    isActive && "text-indigo-200",
                    isPending && "text-zinc-500",
                    isStepError && "text-red-300",
                  )}
                >
                  {pipelineStep.label}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {pipelineStep.description}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Status message */}
      {message && (
        <p
          className={cn(
            "mt-4 rounded-lg px-3 py-2 text-xs",
            isError
              ? "border border-red-500/30 bg-red-500/10 text-red-300"
              : isSuccess
                ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border border-indigo-500/20 bg-indigo-500/10 text-indigo-200",
          )}
        >
          {message}
        </p>
      )}

      {/* Error detail */}
      {isError && error && error !== message && (
        <p className="mt-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      )}

      {/* Transaction hash */}
      {txHash && (
        <HashDisplay
          label="Transaction Hash"
          value={txHash}
          explorerUrl={`${EXPLORER_BASE}/${txHash}`}
        />
      )}

      {/* Dev panel — only rendered outside production */}
      {isDev && (unsignedXdr || signedXdr || simulationLog) && (
        <div className="mt-4 space-y-2 border-t border-zinc-800 pt-4">
          <p className="text-[10px] uppercase tracking-widest text-zinc-600">
            Dev Tools
          </p>

          {simulationLog && <SimLogPanel log={simulationLog} />}
          {unsignedXdr && <XdrPanel label="Unsigned XDR" xdr={unsignedXdr} />}
          {signedXdr && <XdrPanel label="Signed XDR" xdr={signedXdr} />}
        </div>
      )}
    </section>
  );
}
