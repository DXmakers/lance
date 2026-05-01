/**
 * useTransaction.ts
 *
 * React hook for managing transaction lifecycle with immediate UI state updates.
 * Handles building, simulating, signing, submitting, and confirming transactions.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Transaction } from "@stellar/stellar-sdk";
import {
  TransactionLifecycleManager,
  TransactionEvent,
  TransactionState,
  createTransactionLifecycle,
  transactionEventBus,
} from "@/lib/transactions/lifecycle";
import { useTransactionStore, StoredTransaction } from "@/lib/store/transaction-store";
import { submitTransaction, SubmissionResult } from "@/lib/transactions/submitter";
import { pollTransactionStatus, PollingResult } from "@/lib/transactions/poller";
import { simulateTransaction, SimulationResult } from "@/lib/transactions/simulator";
import { calculateAdjustedFee, FeeEstimate } from "@/lib/transactions/fee-estimator";
import { signTransaction } from "@/lib/wallets/signer";
import { SigningRequest, SigningResult } from "@/lib/wallets/provider";
import { sorobanServer } from "@/lib/stellar";

export interface UseTransactionOptions {
  /** Source account address */
  sourceAddress: string;
  /** Optional contract ID */
  contractId?: string;
  /** Optional contract method */
  method?: string;
  /** Callback when transaction succeeds */
  onSuccess?: (result: PollingResult) => void;
  /** Callback when transaction fails */
  onError?: (error: string, code?: string) => void;
  /** Callback for state changes */
  onStateChange?: (state: TransactionState) => void;
  /** Callback for balance refresh */
  onRefreshBalance?: () => Promise<void>;
  /** Callback for escrow status update */
  onUpdateEscrow?: () => Promise<void>;
  /** Callback for milestone update */
  onUpdateMilestones?: () => Promise<void>;
}

export interface UseTransactionResult {
  /** Current transaction state */
  state: TransactionState;
  /** Transaction ID */
  txId: string | null;
  /** Transaction hash */
  txHash: string | null;
  /** Whether transaction is processing */
  isProcessing: boolean;
  /** Error message (if any) */
  error: string | null;
  /** Current transaction event */
  currentEvent: TransactionEvent | null;
  /** Build and simulate transaction */
  buildAndSimulate: (tx: Transaction) => Promise<SimulationResult | null>;
  /** Sign transaction */
  sign: (signingRequest: SigningRequest) => Promise<SigningResult | null>;
  /** Submit transaction */
  submit: (signedXdr: string, sourceAddress: string) => Promise<SubmissionResult | null>;
  /** Cancel transaction */
  cancel: () => void;
  /** Get transaction history */
  getHistory: () => StoredTransaction[];
  /** Get pending transactions */
  getPending: () => StoredTransaction[];
  /** Refresh balances and status */
  refreshStatus: () => Promise<void>;
}

/**
 * React hook for managing transaction lifecycle.
 * Provides state management, event handling, and UI update triggers.
 */
export function useTransaction(options: UseTransactionOptions): UseTransactionResult {
  const {
    sourceAddress,
    contractId,
    method,
    onSuccess,
    onError,
    onStateChange,
    onRefreshBalance,
    onUpdateEscrow,
    onUpdateMilestones,
  } = options;

  const [state, setState] = useState<TransactionState>("IDLE");
  const [txId, setTxId] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentEvent, setCurrentEvent] = useState<TransactionEvent | null>(null);

  const lifecycleRef = useRef<TransactionLifecycleManager | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const store = useTransactionStore();

  // ============================================================
  // ✅ DECLARED FIRST: triggerSuccessUpdates (so it exists when handleTransactionEvent calls it)
  // ============================================================

  /**
   * Triggers UI updates on successful transaction confirmation.
   */
  const triggerSuccessUpdates = useCallback(async () => {
    try {
      // Refresh balances
      if (onRefreshBalance) {
        await onRefreshBalance();
      }

      // Update escrow status
      if (onUpdateEscrow) {
        await onUpdateEscrow();
      }

      // Update milestones
      if (onUpdateMilestones) {
        await onUpdateMilestones();
      }
    } catch (err) {
      console.error("[useTransaction] Error triggering success updates:", err);
    }
  }, [onRefreshBalance, onUpdateEscrow, onUpdateMilestones]);

  // ============================================================
  // ✅ DECLARED SECOND: handleTransactionEvent (now can safely call triggerSuccessUpdates)
  // ============================================================

  /**
   * Handles transaction events and updates UI state.
   */
  const handleTransactionEvent = useCallback(
    async (event: TransactionEvent) => {
      const newState = event.type;

      // Update local state
      setState(newState);
      setCurrentEvent(event);
      setError(event.error || null);

      if (event.metadata.txHash) {
        setTxHash(event.metadata.txHash);
      }

      // Update store
      store.setCurrentTransaction(event);

      // Call state change callback
      onStateChange?.(newState);

      // Handle state-specific logic
      switch (newState) {
        case "BUILDING":
          setIsProcessing(true);
          break;

        case "SIMULATING":
          setIsProcessing(true);
          break;

        case "SIGNING":
          setIsProcessing(true);
          break;

        case "SUBMITTING":
          setIsProcessing(true);
          break;

        case "CONFIRMING":
          setIsProcessing(true);
          break;

        case "SUCCESS":
          setIsProcessing(false);
          // ✅ NOW SAFE: triggerSuccessUpdates is already declared
          await triggerSuccessUpdates();
          onSuccess?.(event.polling!);
          break;

        case "FAILED":
          setIsProcessing(false);
          onError?.(event.error || "Unknown error", event.errorCode);
          break;

        case "IDLE":
          setIsProcessing(false);
          break;
      }

      // Persist to store
      if (newState === "SUCCESS" || newState === "FAILED") {
        const stored: StoredTransaction = {
          id: event.metadata.id,
          txHash: event.metadata.txHash,
          state: newState,
          sourceAddress: event.metadata.sourceAddress,
          contractId: event.metadata.contractId,
          method: event.metadata.method,
          createdAt: event.metadata.createdAt.toISOString(),
          completedAt: event.metadata.completedAt?.toISOString(),
          error: event.error,
          ledger: event.polling?.ledger,
          explorerLink: event.metadata.txHash
            ? `https://stellar.expert/explorer/testnet/tx/${event.metadata.txHash}`
            : undefined,
        };

        store.addToHistory(stored);
      }
    },
    [store, onStateChange, onSuccess, onError, triggerSuccessUpdates],
  );

  // ============================================================
  // ✅ initializeLifecycle (now safe to call handleTransactionEvent)
  // ============================================================

  /**
   * Initializes a new transaction lifecycle.
   */
  const initializeLifecycle = useCallback(() => {
    lifecycleRef.current = createTransactionLifecycle(sourceAddress, contractId, method);
    setTxId(lifecycleRef.current.getId());

    // Subscribe to lifecycle events (NOW safe because handleTransactionEvent is defined)
    unsubscribeRef.current = lifecycleRef.current.subscribe((event) => {
      handleTransactionEvent(event);
    });

    // Also emit to global event bus
    transactionEventBus.subscribe((event) => {
      if (event.metadata.id === lifecycleRef.current?.getId()) {
        handleTransactionEvent(event);
      }
    });
  }, [sourceAddress, contractId, method, handleTransactionEvent]);

  // ============================================================
  // All other functions remain the same
  // ============================================================

  /**
   * Builds and simulates a transaction.
   */
  const buildAndSimulate = useCallback(
    async (tx: Transaction): Promise<SimulationResult | null> => {
      if (!lifecycleRef.current) {
        initializeLifecycle();
      }

      try {
        lifecycleRef.current!.transitionToBuilding(tx, tx.toXDR());

        lifecycleRef.current!.transitionToSimulating();

        const simulation = await simulateTransaction(sorobanServer, tx);

        if (!simulation) {
          throw new Error("Simulation returned no result");
        }

        const feeEstimate = calculateAdjustedFee(simulation.minResourceFee);

        lifecycleRef.current!.transitionSimulationComplete(
          simulation,
          feeEstimate,
          simulation,
        );

        return simulation;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        lifecycleRef.current!.transitionToFailed(errorMsg, "SIMULATION_ERROR");
        throw err;
      }
    },
    [initializeLifecycle],
  );

  /**
   * Signs a transaction.
   */
  const sign = useCallback(
    async (signingRequest: SigningRequest): Promise<SigningResult | null> => {
      if (!lifecycleRef.current) {
        initializeLifecycle();
      }

      try {
        lifecycleRef.current!.transitionToSigning();

        const result = await signTransaction(signingRequest);

        lifecycleRef.current!.transitionSigningComplete(result.signedXdr);

        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        lifecycleRef.current!.transitionToFailed(errorMsg, "SIGNING_ERROR");
        throw err;
      }
    },
    [initializeLifecycle],
  );

  /**
   * Submits a transaction.
   */
  const submit = useCallback(
    async (signedXdr: string, sourceAddr: string): Promise<SubmissionResult | null> => {
      if (!lifecycleRef.current) {
        initializeLifecycle();
      }

      try {
        lifecycleRef.current!.transitionToSubmitting();

        const signedTx = new Transaction(signedXdr, "testnet");
        const result = await submitTransaction(signedTx, sourceAddr);

        lifecycleRef.current!.transitionSubmissionComplete(result);

        if (result.hash) {
          lifecycleRef.current!.transitionToConfirming(result.hash);
        }

        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        lifecycleRef.current!.transitionToFailed(errorMsg, "SUBMISSION_ERROR");
        throw err;
      }
    },
    [initializeLifecycle],
  );

  /**
   * Cancels the current transaction.
   */
  const cancel = useCallback(() => {
    if (lifecycleRef.current) {
      lifecycleRef.current.transitionToFailed("User cancelled transaction", "CANCELLED");
    }
    setIsProcessing(false);
  }, []);

  /**
   * Gets transaction history.
   */
  const getHistory = useCallback(() => {
    return store.getRecentTransactions();
  }, [store]);

  /**
   * Gets pending transactions.
   */
  const getPending = useCallback(() => {
    return store.getPendingTransactions();
  }, [store]);

  /**
   * Refreshes transaction status and related data.
   */
  const refreshStatus = useCallback(async () => {
    if (txHash) {
      try {
        const result = await pollTransactionStatus(txHash);

        if (result.status === "SUCCESS") {
          lifecycleRef.current?.transitionToSuccess(result, txHash);
        } else if (result.status === "FAILED") {
          lifecycleRef.current?.transitionToFailed("Transaction failed on-chain", "ON_CHAIN_FAILURE", result);
        } else if (result.status === "TIMEOUT") {
          lifecycleRef.current?.transitionToFailed("Transaction confirmation timed out", "TIMEOUT");
        }
      } catch (err) {
        console.error("[useTransaction] Error refreshing status:", err);
      }
    }
  }, [txHash]);

  /**
   * Initialize lifecycle on mount.
   */
  useEffect(() => {
    initializeLifecycle();

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [initializeLifecycle]);

  return {
    state,
    txId,
    txHash,
    isProcessing,
    error,
    currentEvent,
    buildAndSimulate,
    sign,
    submit,
    cancel,
    getHistory,
    getPending,
    refreshStatus,
  };
}
