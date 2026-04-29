/**
 * use-soroban-estimate.ts
 *
 * React hook for Soroban resource fee estimation with reactive state management.
 *
 * Features:
 *  - Automatic re-estimation when parameters change
 *  - Debounced estimation for performance
 *  - Error handling with retry logic
 *  - Loading states for UI feedback
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  SorobanResourceEstimator,
  SimulationResult,
  EstimateContractCallParams,
  ResourceEstimate,
} from "@/lib/soroban-resource-estimator";
import { xdr } from "@stellar/stellar-sdk";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseSorobanEstimateOptions {
  /** RPC URL for estimation */
  rpcUrl?: string;
  /** Debounce delay in ms (default: 500) */
  debounceMs?: number;
  /** Enable automatic re-estimation on parameter changes */
  autoEstimate?: boolean;
  /** Callback when estimation completes */
  onEstimate?: (result: SimulationResult) => void;
  /** Callback when estimation fails */
  onError?: (error: Error) => void;
}

export interface UseSorobanEstimateReturn {
  /** Current estimation result */
  result: SimulationResult | null;
  /** Whether estimation is in progress */
  isLoading: boolean;
  /** Error from last estimation attempt */
  error: Error | null;
  /** Trigger a new estimation */
  estimate: (params: EstimateContractCallParams) => Promise<void>;
  /** Retry the last estimation */
  retry: () => void;
  /** Clear current result and error */
  reset: () => void;
  /** Human-readable fee summary */
  feeSummary: FeeSummary | null;
  /** Resource utilization percentages */
  utilization: ResourceUtilization | null;
}

export interface FeeSummary {
  /** Total fee in XLM */
  totalXlm: string;
  /** Base fee component */
  baseFeeStroops: string;
  /** Resource fee component */
  resourceFeeStroops: string;
  /** Refundable fee portion */
  refundableFeeStroops: string;
}

export interface ResourceUtilization {
  /** CPU utilization percentage */
  cpu: number;
  /** Memory utilization percentage */
  memory: number;
  /** Read ledger entries utilization */
  readEntries: number;
  /** Write ledger entries utilization */
  writeEntries: number;
  /** Whether any resources are near limits */
  hasWarnings: boolean;
  /** Warning messages */
  warnings: string[];
}

// ─── Hook Implementation ───────────────────────────────────────────────────────

export function useSorobanEstimate(
  options: UseSorobanEstimateOptions = {}
): UseSorobanEstimateReturn {
  const {
    rpcUrl,
    debounceMs = 500,
    autoEstimate = false,
    onEstimate,
    onError,
  } = options;

  const estimatorRef = useRef<SorobanResourceEstimator | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastParamsRef = useRef<EstimateContractCallParams | null>(null);

  const [result, setResult] = useState<SimulationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Initialize estimator
  useEffect(() => {
    estimatorRef.current = new SorobanResourceEstimator(rpcUrl);
    return () => {
      estimatorRef.current = null;
    };
  }, [rpcUrl]);

  // Calculate derived values
  const feeSummary: FeeSummary | null = result
    ? {
        totalXlm: result.fees.totalFeeXlm,
        baseFeeStroops: result.fees.baseFee,
        resourceFeeStroops: result.fees.resourceFee,
        refundableFeeStroops: result.fees.refundableFee,
      }
    : null;

  const utilization: ResourceUtilization | null = result
    ? {
        cpu: result.limitsCheck.cpuUtilizationPct,
        memory: result.limitsCheck.memUtilizationPct,
        readEntries: result.limitsCheck.readEntriesUtilizationPct,
        writeEntries: result.limitsCheck.writeEntriesUtilizationPct,
        hasWarnings: result.limitsCheck.warnings.length > 0,
        warnings: result.limitsCheck.warnings.map((w) => w.message),
      }
    : null;

  // Main estimation function
  const estimate = useCallback(
    async (params: EstimateContractCallParams) => {
      if (!estimatorRef.current) {
        setError(new Error("Estimator not initialized"));
        return;
      }

      // Clear any pending debounced call
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      setIsLoading(true);
      setError(null);
      lastParamsRef.current = params;

      try {
        const simulationResult = await estimatorRef.current.estimateContractCall(params);
        setResult(simulationResult);
        onEstimate?.(simulationResult);
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Estimation failed");
        setError(error);
        onError?.(error);
      } finally {
        setIsLoading(false);
      }
    },
    [onEstimate, onError]
  );

  // Debounced estimation for parameter changes
  const estimateDebounced = useCallback(
    (params: EstimateContractCallParams) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        estimate(params);
      }, debounceMs);
    },
    [estimate, debounceMs]
  );

  // Retry last estimation
  const retry = useCallback(() => {
    if (lastParamsRef.current) {
      setRetryCount((c) => c + 1);
      estimate(lastParamsRef.current);
    }
  }, [estimate]);

  // Reset state
  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setIsLoading(false);
    lastParamsRef.current = null;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    result,
    isLoading,
    error,
    estimate: autoEstimate ? estimateDebounced : estimate,
    retry,
    reset,
    feeSummary,
    utilization,
  };
}

// ─── Utility Hooks ─────────────────────────────────────────────────────────────

/**
 * Hook for quick fee estimation without full simulation details
 */
export function useQuickFeeEstimate(
  contractId: string,
  functionName: string,
  args: xdr.ScVal[],
  sourceAddress: string,
  options?: UseSorobanEstimateOptions
) {
  const estimate = useSorobanEstimate(options);

  useEffect(() => {
    if (contractId && functionName && sourceAddress) {
      estimate.estimate({
        contractId,
        functionName,
        args,
        sourceAddress,
      });
    }
  }, [contractId, functionName, sourceAddress, ...args.map((a) => a.toXDR("base64"))]);

  return estimate;
}
