"use client";

/**
 * TransactionTracker – Visual progress indicator for the
 * Soroban transaction lifecycle: Build → Simulate → Sign → Submit → Confirm
 *
 * Shows step-by-step progress with:
 *  - Animated pulsing ring for the active step
 *  - Monospace XDR/hash details in dev mode
 *  - Simulation diagnostics (fee, resources)
 *  - Direct links to Stellar Explorer for confirmed tx hashes
 *  - High-contrast success/error messaging
 */

import { useTxStatusStore } from "@/lib/store/use-tx-status-store";
import type { TxLifecycleStep } from "@/lib/job-registry";
import {
  CheckCircle,
  XCircle,
  Loader2,
  FileCode,
  Cpu,
  PenTool,
  Send,
  ShieldCheck,
  Circle,
  Terminal,
} from "lucide-react";

// ─── Step Configuration ─────────────────────────────────────────────────────

interface StepDef {
  key: TxLifecycleStep;
  label: string;
  icon: React.ElementType;
}

const STEPS: StepDef[] = [
  { key: "building", label: "Build", icon: FileCode },
  { key: "simulating", label: "Simulate", icon: Cpu },
  { key: "signing", label: "Sign", icon: PenTool },
  { key: "submitting", label: "Submit", icon: Send },
  { key: "confirming", label: "Confirm", icon: ShieldCheck },
];

const STEP_INDEX: Record<TxLifecycleStep, number> = {
  idle: -1,
  building: 0,
  simulating: 1,
  signing: 2,
  submitting: 3,
  confirming: 4,
  confirmed: 5,
  failed: -1,
};

// ─── Explorer URL ───────────────────────────────────────────────────────────

const STELLAR_EXPLORER_URL =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "PUBLIC"
    ? "https://stellar.expert/explorer/public/tx"
    : "https://stellar.expert/explorer/testnet/tx";

// ─── Component ──────────────────────────────────────────────────────────────

export function TransactionTracker() {
  const { step, detail, txHash, rawXdr, simulation, startedAt, finishedAt } =
    useTxStatusStore();

  // Nothing to show when idle
  if (step === "idle") return null;

  const currentIdx = STEP_INDEX[step as TxLifecycleStep];
  const isFailed = step === "failed";
  const isConfirmed = step === "confirmed";
  const elapsed =
    startedAt && finishedAt ? ((finishedAt - startedAt) / 1000).toFixed(1) : null;

  return (
    <div className="rounded-[2rem] border border-slate-200 bg-white/85 p-6 shadow-[0_25px_80px_-48px_rgba(15,23,42,0.5)]">
      {/* ── Progress Steps ────────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          {STEPS.map((s, idx) => {
            const isActive = currentIdx === idx;
            const isCompleted = currentIdx > idx || isConfirmed;
            const Icon = s.icon;

            return (
              <div key={s.key} className="flex flex-col items-center gap-1.5">
                <div
                  className={`
                    relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all
                    ${isCompleted ? "border-emerald-500 bg-emerald-50 text-emerald-600" : ""}
                    ${isActive ? "border-amber-400 bg-amber-50 text-amber-600" : ""}
                    ${!isActive && !isCompleted ? "border-slate-200 bg-slate-50 text-slate-400" : ""}
                  `}
                >
                  {isCompleted ? (
                    <CheckCircle className="h-5 w-5" />
                  ) : isActive ? (
                    <>
                      {/* pulsing ring */}
                      <span className="absolute inset-0 animate-ping rounded-full border-2 border-amber-400/40" />
                      <Icon className="h-5 w-5" />
                    </>
                  ) : (
                    <Circle className="h-5 w-5" />
                  )}
                </div>
                <span
                  className={`text-xs font-medium ${
                    isCompleted
                      ? "text-emerald-600"
                      : isActive
                        ? "text-amber-600"
                        : "text-slate-400"
                  }`}
                >
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100">
          <div
            className={`h-1.5 rounded-full transition-all duration-500 ${
              isFailed ? "bg-red-500" : isConfirmed ? "bg-emerald-500" : "bg-amber-400"
            }`}
            style={{
              width: `${Math.min(100, ((currentIdx + (isConfirmed ? 1 : 0)) / STEPS.length) * 100)}%`,
            }}
          />
        </div>
      </div>

      {/* ── Status Message ─────────────────────────────────────────────── */}
      {isConfirmed && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-emerald-600" />
            <span className="font-semibold text-emerald-800">
              Transaction Confirmed
            </span>
            {elapsed && (
              <span className="ml-auto text-xs text-emerald-600">
                {elapsed}s
              </span>
            )}
          </div>
          {txHash && (
            <a
              href={`${STELLAR_EXPLORER_URL}/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block font-mono text-xs text-emerald-700 underline hover:text-emerald-900"
            >
              {txHash}
            </a>
          )}
        </div>
      )}

      {isFailed && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-600" />
            <span className="font-semibold text-red-800">
              Transaction Failed
            </span>
          </div>
          {detail && (
            <p className="mt-2 text-sm text-red-700">{detail}</p>
          )}
        </div>
      )}

      {/* Active step indicator */}
      {!isConfirmed && !isFailed && (
        <div className="mb-4 flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
          <span>
            {step === "building" && "Building transaction..."}
            {step === "simulating" && "Simulating on Soroban..."}
            {step === "signing" && "Waiting for wallet signature..."}
            {step === "submitting" && "Submitting to network..."}
            {step === "confirming" && "Waiting for ledger confirmation..."}
          </span>
        </div>
      )}

      {/* ── Simulation Diagnostics ─────────────────────────────────────── */}
      {simulation && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Simulation Result
          </h4>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-slate-500">Estimated Fee</span>
              <p className="font-mono text-slate-800">
                {`${(Number(simulation.fee) / 10_000_000).toFixed(6)} XLM`}
              </p>
            </div>
            <div>
              <span className="text-slate-500">CPU Instructions</span>
              <p className="font-mono text-slate-800">
                {simulation.cpuInstructions}
              </p>
            </div>
            <div>
              <span className="text-slate-500">Memory Bytes</span>
              <p className="font-mono text-slate-800">
                {simulation.memoryBytes}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Raw XDR (Technical Transparency) ─────────────────────────────── */}
      {rawXdr && (
        <div className="mt-4 rounded-xl border border-slate-950 bg-slate-900 p-4 text-white">
          <div className="mb-2 flex items-center gap-2">
            <Terminal className="h-4 w-4 text-amber-400" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Raw Transaction XDR
            </h4>
          </div>
          <div className="relative">
            <pre className="max-h-32 overflow-y-auto break-all font-mono text-[10px] leading-relaxed text-slate-300">
              {rawXdr}
            </pre>
            <div className="absolute top-0 right-0 rounded bg-slate-800 px-1.5 py-0.5 text-[8px] font-bold uppercase text-slate-400">
              Base64
            </div>
          </div>
          <p className="mt-2 text-[10px] text-slate-500">
            This XDR represents the exact operations being sent to the Stellar network.
          </p>
        </div>
      )}
    </div>
  );
}
