"use client";

/**
 * ProgressTracker.tsx
 *
 * Visual progress indicator for the transaction lifecycle.
 * Shows 5 steps: Build → Simulate → Sign → Submit → Confirm
 * with animated status indicators and real-time updates.
 */

import React from "react";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  FileCode,
  Cpu,
  PenTool,
  Send,
  ShieldCheck,
  Circle,
} from "lucide-react";
import { TransactionState } from "@/lib/transactions/lifecycle";

interface ProgressTrackerProps {
  /** Current transaction state */
  state: TransactionState;
  /** Whether transaction is processing */
  isProcessing: boolean;
  /** Error message (if any) */
  error?: string | null;
}

interface StepDef {
  key: TransactionState;
  label: string;
  icon: React.ElementType;
}

const STEPS: StepDef[] = [
  { key: "BUILDING", label: "Build", icon: FileCode },
  { key: "SIMULATING", label: "Simulate", icon: Cpu },
  { key: "SIGNING", label: "Sign", icon: PenTool },
  { key: "SUBMITTING", label: "Submit", icon: Send },
  { key: "CONFIRMING", label: "Confirm", icon: ShieldCheck },
];

const STEP_INDEX: Record<TransactionState, number> = {
  IDLE: -1,
  BUILDING: 0,
  SIMULATING: 1,
  SIGNING: 2,
  SUBMITTING: 3,
  CONFIRMING: 4,
  SUCCESS: 5,
  FAILED: -1,
};

/**
 * ProgressTracker component showing transaction lifecycle progress.
 */
export function ProgressTracker({
  state,
  isProcessing,
  error,
}: ProgressTrackerProps) {
  const currentIdx = STEP_INDEX[state];
  const isFailed = state === "FAILED";
  const isSuccess = state === "SUCCESS";

  // Don't show tracker when idle
  if (state === "IDLE") {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Progress Steps */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          {STEPS.map((step, idx) => {
            const isActive = currentIdx === idx;
            const isCompleted = currentIdx > idx || isSuccess;
            const Icon = step.icon;

            return (
              <div key={step.key} className="flex flex-col items-center gap-2">
                {/* Step Circle */}
                <div
                  className={`
                    relative flex h-12 w-12 items-center justify-center rounded-full border-2 transition-all duration-300
                    ${
                      isCompleted
                        ? "border-green-500 bg-green-50 text-green-600"
                        : ""
                    }
                    ${
                      isActive
                        ? "border-amber-400 bg-amber-50 text-amber-600"
                        : ""
                    }
                    ${
                      !isActive && !isCompleted
                        ? "border-slate-200 bg-slate-50 text-slate-400"
                        : ""
                    }
                    ${isFailed && isActive ? "border-red-500 bg-red-50 text-red-600" : ""}
                  `}
                >
                  {isCompleted && !isFailed ? (
                    <CheckCircle2 className="h-6 w-6" />
                  ) : isActive && !isFailed ? (
                    <>
                      {/* Pulsing ring animation */}
                      <span className="absolute inset-0 animate-pulse rounded-full border-2 border-amber-400/50" />
                      <Icon className="relative h-6 w-6" />
                    </>
                  ) : isActive && isFailed ? (
                    <>
                      <span className="absolute inset-0 rounded-full border-2 border-red-400/50" />
                      <XCircle className="relative h-6 w-6" />
                    </>
                  ) : (
                    <Circle className="h-6 w-6" />
                  )}
                </div>

                {/* Step Label */}
                <span
                  className={`text-xs font-semibold transition-colors duration-300 ${
                    isCompleted && !isFailed
                      ? "text-green-600"
                      : isActive
                        ? isFailed
                          ? "text-red-600"
                          : "text-amber-600"
                        : "text-slate-400"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Progress Bar */}
        <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
          <div
            className={`h-2 rounded-full transition-all duration-500 ${
              isFailed
                ? "bg-red-500"
                : isSuccess
                  ? "bg-green-500"
                  : "bg-amber-400"
            }`}
            style={{
              width: `${Math.min(100, ((currentIdx + (isSuccess ? 1 : 0)) / STEPS.length) * 100)}%`,
            }}
          />
        </div>
      </div>

      {/* Status Message */}
      {isSuccess && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <span className="font-semibold text-green-800">
              Transaction Confirmed
            </span>
          </div>
        </div>
      )}

      {isFailed && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-600" />
            <span className="font-semibold text-red-800">
              Transaction Failed
            </span>
          </div>
          {error && (
            <p className="mt-2 text-sm text-red-700">{error}</p>
          )}
        </div>
      )}

      {/* Active Step Indicator */}
      {!isSuccess && !isFailed && isProcessing && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
          <span>
            {state === "BUILDING" && "Building transaction..."}
            {state === "SIMULATING" && "Simulating on Soroban..."}
            {state === "SIGNING" && "Waiting for wallet signature..."}
            {state === "SUBMITTING" && "Submitting to network..."}
            {state === "CONFIRMING" && "Waiting for ledger confirmation..."}
          </span>
        </div>
      )}
    </div>
  );
}
