/**
 * use-soroban-transaction.ts
 *
 * React hook that wraps the Soroban 5-step pipeline and exposes:
 *  - Per-step progress state for UI rendering
 *  - Raw XDR and simulation logs (dev environments only)
 *  - A typed execute() function that accepts any contract invocation
 *  - Automatic UI state refresh callback on success
 *  - Error state with human-readable messages
 */

"use client";

import { useCallback, useRef, useState } from "react";
import {
  invokeContract,
  type InvokeContractParams,
  type PipelineProgressEvent,
  type PipelineResult,
  type PipelineStep,
  type SimulationLog,
} from "@/lib/soroban-pipeline";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SorobanTransactionState {
  /** Current pipeline step */
  step: PipelineStep;
  /** True while any step is in progress */
  isPending: boolean;
  /** Confirmed transaction hash (available after success) */
  txHash: string | null;
  /** Human-readable status message */
  message: string;
  /** Error message if the pipeline failed */
  error: string | null;
  /** Simulation diagnostics — only populated in non-production builds */
  simulationLog: SimulationLog | null;
  /** Unsigned transaction XDR — only populated in non-production builds */
  unsignedXdr: string | null;
  /** Signed transaction XDR — only populated in non-production builds */
  signedXdr: string | null;
  /** Ordered history of all progress events for the current invocation */
  progressHistory: PipelineProgressEvent[];
}

export interface ExecuteOptions {
  /** Called with the confirmed tx hash after a successful pipeline run */
  onSuccess?: (result: PipelineResult) => void | Promise<void>;
  /** Called with the thrown error if the pipeline fails */
  onError?: (error: Error) => void;
}

export interface UseSorobanTransactionReturn extends SorobanTransactionState {
  /**
   * Execute the full Build → Simulate → Sign → Submit → Confirm pipeline.
   *
   * @param params  Contract invocation parameters (contractId, method, args, …)
   * @param options Optional success/error callbacks
   */
  execute: (
    params: Omit<InvokeContractParams, "onProgress">,
    options?: ExecuteOptions,
  ) => Promise<PipelineResult | null>;
  /** Reset all state back to idle */
  reset: () => void;
}

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL_STATE: SorobanTransactionState = {
  step: "idle",
  isPending: false,
  txHash: null,
  message: "Ready.",
  error: null,
  simulationLog: null,
  unsignedXdr: null,
  signedXdr: null,
  progressHistory: [],
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSorobanTransaction(): UseSorobanTransactionReturn {
  const [state, setState] = useState<SorobanTransactionState>(INITIAL_STATE);

  // Guard against state updates after unmount
  const mountedRef = useRef(true);
  const setStateSafe = useCallback(
    (updater: (prev: SorobanTransactionState) => SorobanTransactionState) => {
      if (mountedRef.current) {
        setState(updater);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setStateSafe(() => INITIAL_STATE);
  }, [setStateSafe]);

  const execute = useCallback(
    async (
      params: Omit<InvokeContractParams, "onProgress">,
      options?: ExecuteOptions,
    ): Promise<PipelineResult | null> => {
      // Reset to a clean pending state before starting
      setStateSafe(() => ({
        ...INITIAL_STATE,
        step: "building",
        isPending: true,
        message: "Building transaction…",
      }));

      const onProgress = (event: PipelineProgressEvent) => {
        setStateSafe((prev) => ({
          ...prev,
          step: event.step,
          isPending: event.step !== "success" && event.step !== "error",
          message: event.message,
          txHash: event.txHash ?? prev.txHash,
          simulationLog: event.simulationLog ?? prev.simulationLog,
          unsignedXdr: event.unsignedXdr ?? prev.unsignedXdr,
          signedXdr: event.signedXdr ?? prev.signedXdr,
          progressHistory: [...prev.progressHistory, event],
        }));
      };

      try {
        const result = await invokeContract({ ...params, onProgress });

        setStateSafe((prev) => ({
          ...prev,
          step: "success",
          isPending: false,
          txHash: result.txHash,
          simulationLog: result.simulationLog ?? prev.simulationLog,
          unsignedXdr: result.unsignedXdr ?? prev.unsignedXdr,
          signedXdr: result.signedXdr ?? prev.signedXdr,
          error: null,
          message: "Transaction confirmed on-chain.",
        }));

        await options?.onSuccess?.(result);
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "An unexpected error occurred.";

        setStateSafe((prev) => ({
          ...prev,
          step: "error",
          isPending: false,
          error: message,
          message,
        }));

        if (err instanceof Error) {
          options?.onError?.(err);
        }

        return null;
      }
    },
    [setStateSafe],
  );

  return { ...state, execute, reset };
}
