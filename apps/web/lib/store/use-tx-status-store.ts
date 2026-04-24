/**
 * Zustand store for tracking multi-step Soroban transaction lifecycle.
 *
 * Tracks: idle → building → simulating → signing → submitting → confirming → confirmed/failed
 * Provides simulation diagnostics and transaction hash for UI rendering.
 */

import { create } from "zustand";
import type { TxLifecycleStep, SimulationResult } from "@/lib/job-registry";

export interface TxStatusState {
  /** Current lifecycle step. */
  step: TxLifecycleStep;
  /** Human-readable detail for the current step (e.g. error message or tx hash). */
  detail: string | null;
  /** On-chain transaction hash once available. */
  txHash: string | null;
  /** Simulation diagnostics (fee, resources). */
  simulation: SimulationResult | null;
  /** Timestamp (ms) when the current transaction started. */
  startedAt: number | null;
  /** Timestamp (ms) when the transaction reached a terminal state. */
  finishedAt: number | null;

  // ── Actions ────────────────────────────────────────────────────────────
  setStep: (step: TxLifecycleStep, detail?: string) => void;
  setTxHash: (hash: string) => void;
  setSimulation: (simulation: SimulationResult) => void;
  reset: () => void;
}

const INITIAL = {
  step: "idle" as TxLifecycleStep,
  detail: null as string | null,
  txHash: null as string | null,
  simulation: null as SimulationResult | null,
  startedAt: null as number | null,
  finishedAt: null as number | null,
};

export const useTxStatusStore = create<TxStatusState>()((set) => ({
  ...INITIAL,

  setStep: (step, detail) =>
    set((state) => ({
      step,
      detail: detail ?? null,
      startedAt:
        step === "building" && state.startedAt === null
          ? Date.now()
          : state.startedAt,
      finishedAt:
        step === "confirmed" || step === "failed" ? Date.now() : null,
    })),

  setTxHash: (hash) => set({ txHash: hash }),

  setSimulation: (simulation) => set({ simulation }),

  reset: () => set(INITIAL),
}));
