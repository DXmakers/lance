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
  /** Human-readable detail for the current step (e.g. error message). */
  detail: string | null;
  /** On-chain transaction hash once available. */
  txHash: string | null;
  /** Unsigned XDR of the transaction (base64). */
  unsignedXdr: string | null;
  /** Signed XDR of the transaction (base64). */
  signedXdr: string | null;
  /** Simulation diagnostics (fee, resources). */
  simulation: SimulationResult | null;
  /** Timestamp (ms) when the current transaction started. */
  startedAt: number | null;
  /** Timestamp (ms) when the transaction reached a terminal state. */
  finishedAt: number | null;

  // ── Actions ────────────────────────────────────────────────────────────
  setStep: (step: TxLifecycleStep, detail?: string) => void;
  setTxHash: (hash: string) => void;
  setUnsignedXdr: (xdr: string | null) => void;
  setSignedXdr: (xdr: string | null) => void;
  setSimulation: (simulation: SimulationResult | null) => void;
  reset: () => void;
}

const INITIAL = {
  step: "idle" as TxLifecycleStep,
  detail: null as string | null,
  txHash: null as string | null,
  unsignedXdr: null as string | null,
  signedXdr: null as string | null,
  simulation: null as SimulationResult | null,
  startedAt: null as number | null,
  finishedAt: null as number | null,
};

export const useTxStatusStore = create<TxStatusState>()((set) => ({
  ...INITIAL,

  setStep: (step: TxLifecycleStep, detail?: string) =>
    set((state: TxStatusState) => ({
      step,
      detail: detail ?? null,
      startedAt:
        step === "building" && state.startedAt === null
          ? Date.now()
          : state.startedAt,
      finishedAt:
        step === "confirmed" || step === "failed" ? Date.now() : state.finishedAt,
    })),

  setTxHash: (hash: string) => set({ txHash: hash }),
  setUnsignedXdr: (xdr: string | null) => set({ unsignedXdr: xdr }),
  setSignedXdr: (xdr: string | null) => set({ signedXdr: xdr }),
  setSimulation: (simulation: SimulationResult | null) => set({ simulation }),
  reset: () => set(INITIAL),
}));
