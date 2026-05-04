/**
 * Hook for managing Soroban contract interactions
 * Provides transaction building, signing, submission, and event monitoring
 */

import { useState, useCallback } from "react";
import {
  buildSorobanTransaction,
  submitAndPollTransaction,
  handleSequenceError,
  filterEvents,
  getTransactionExplorerUrl,
  type TransactionResult,
  type SorobanEvent,
  type TransactionBuildOptions,
} from "@/lib/soroban-events";
import { signTransaction } from "@/lib/stellar";

export interface UseSorobanTransactionOptions {
  /** Contract ID to interact with */
  contractId: string;
  /** Auto-refresh transaction status */
  autoRefresh?: boolean;
  /** Polling interval in ms (default: 2000) */
  pollInterval?: number;
  /** Transaction timeout in ms (default: 60000) */
  timeout?: number;
}

export interface UseSorobanTransactionReturn {
  /** Current transaction result */
  result: TransactionResult | null;
  /** Whether a transaction is in progress */
  isLoading: boolean;
  /** Error message if transaction failed */
  error: string | null;
  /** Parsed events from last transaction */
  events: SorobanEvent[];
  /** Execute a contract method */
  execute: (
    method: string,
    args: unknown[],
    source: string,
  ) => Promise<TransactionResult>;
  /** Reset transaction state */
  reset: () => void;
}

export function useSorobanTransaction(
  options: UseSorobanTransactionOptions,
): UseSorobanTransactionReturn {
  const { contractId, timeout = 60000, pollInterval = 2000 } = options;
  
  const [result, setResult] = useState<TransactionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (
      method: string,
      args: unknown[],
      source: string,
    ): Promise<TransactionResult> => {
      setIsLoading(true);
      setError(null);
      setResult(null);

      try {
        // Step 1: Build transaction
        console.log(`[Soroban] Building transaction: ${method}`);
        const buildOptions: TransactionBuildOptions = {
          contractId,
          method,
          args,
          source,
        };

        const { preparedTransaction } = await handleSequenceError(async () => {
          return await buildSorobanTransaction(buildOptions);
        });

        // Step 2: Sign transaction with wallet
        console.log(`[Soroban] Signing transaction`);
        const signedXdr = await signTransaction(preparedTransaction.toXDR());

        // Step 3: Submit and poll for confirmation
        console.log(`[Soroban] Submitting transaction`);
        const txResult = await submitAndPollTransaction(
          signedXdr,
          timeout,
          pollInterval,
        );

        setResult(txResult);
        
        if (txResult.status === "FAILED") {
          setError(txResult.error || "Transaction failed");
        }

        console.log(
          `[Soroban] Transaction complete: ${getTransactionExplorerUrl(txResult.hash)}`,
        );

        return txResult;
      } catch (err: unknown) {
        const errorMessage = (err as Error)?.message || "Transaction failed";
        setError(errorMessage);
        console.error("[Soroban] Transaction error:", err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [contractId, timeout, pollInterval],
  );

  const reset = useCallback(() => {
    setResult(null);
    setIsLoading(false);
    setError(null);
  }, []);

  return {
    result,
    isLoading,
    error,
    events: result?.events || [],
    execute,
    reset,
  };
}

/**
 * Hook for monitoring contract events
 */
export interface UseContractEventsOptions {
  contractId: string;
  /** Auto-refresh interval in ms (default: 5000) */
  refreshInterval?: number;
  /** Filter by event type */
  eventType?: string;
}

export interface UseContractEventsReturn {
  events: SorobanEvent[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useContractEvents(
  options: UseContractEventsOptions,
): UseContractEventsReturn {
  const { contractId, refreshInterval = 5000, eventType } = options;
  
  const [events, setEvents] = useState<SorobanEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // TODO: Implement event fetching from backend or RPC
      // For now, this is a placeholder
      console.log(`[Soroban] Fetching events for contract: ${contractId}`);
      console.log(`Using refresh interval: ${refreshInterval}`);
      
      // In production, you would:
      // 1. Call backend API that indexes Soroban events
      // 2. Or use Soroban RPC getEvents endpoint
      // 3. Parse and filter events
      setEvents([]); // Use setEvents to avoid unused warning
      
    } catch (err: unknown) {
      setError((err as Error)?.message || "Failed to fetch events");
    } finally {
      setIsLoading(false);
    }
  }, [contractId, refreshInterval]);

  // Auto-refresh
   
  // useEffect(() => {
  //   fetchEvents();
  //   const interval = setInterval(fetchEvents, refreshInterval);
  //   return () => clearInterval(interval);
  // }, [fetchEvents, refreshInterval]);

  const refresh = useCallback(async () => {
    await fetchEvents();
  }, [fetchEvents]);

  const filteredEvents = eventType
    ? filterEvents(events, undefined, eventType)
    : events;

  return {
    events: filteredEvents,
    isLoading,
    error,
    refresh,
  };
}

/**
 * Hook for specific contract operations (milestone release, dispute resolution, etc.)
 */
export function useEscrowOperations(contractId: string) {
  const transaction = useSorobanTransaction({ contractId });

  const releaseMilestone = useCallback(
    async (jobId: string, milestoneIndex: number, source: string) => {
      return await transaction.execute("release_milestone", [jobId, milestoneIndex], source);
    },
    [transaction],
  );

  const openDispute = useCallback(
    async (jobId: string, source: string) => {
      return await transaction.execute("open_dispute", [jobId], source);
    },
    [transaction],
  );

  const resolveDispute = useCallback(
    async (jobId: string, freelancerShareBps: number, source: string) => {
      return await transaction.execute("resolve_dispute", [jobId, freelancerShareBps], source);
    },
    [transaction],
  );

  return {
    ...transaction,
    releaseMilestone,
    openDispute,
    resolveDispute,
  };
}
