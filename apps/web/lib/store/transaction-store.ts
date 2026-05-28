/**
 * transaction-store.ts
 *
 * Zustand store for transaction state management.
 * Persists transaction history and manages UI state updates.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { TransactionEvent, TransactionState } from "../transactions/lifecycle";

export interface StoredTransaction {
  /** Unique transaction ID */
  id: string;
  /** Transaction hash */
  txHash?: string;
  /** Current state */
  state: TransactionState;
  /** Source account address */
  sourceAddress: string;
  /** Contract ID (if applicable) */
  contractId?: string;
  /** Contract method (if applicable) */
  method?: string;
  /** Timestamp of creation */
  createdAt: string;
  /** Timestamp of completion */
  completedAt?: string;
  /** Error message (if failed) */
  error?: string;
  /** Fee paid in stroops */
  fee?: string;
  /** Ledger number (if confirmed) */
  ledger?: number;
  /** Block explorer link */
  explorerLink?: string;
}

export interface TransactionStoreState {
  /** Current transaction being processed */
  currentTransaction: TransactionEvent | null;
  /** Recent transaction history */
  history: StoredTransaction[];
  /** Pending transactions (not yet confirmed) */
  pending: StoredTransaction[];
  /** Whether a transaction is in progress */
  isProcessing: boolean;
  /** Current processing state */
  processingState: TransactionState;
  /** Error message (if any) */
  error: string | null;

  // Actions
  setCurrentTransaction: (event: TransactionEvent | null) => void;
  addToHistory: (tx: StoredTransaction) => void;
  updatePending: (txId: string, updates: Partial<StoredTransaction>) => void;
  removePending: (txId: string) => void;
  setProcessing: (isProcessing: boolean, state: TransactionState) => void;
  setError: (error: string | null) => void;
  clearHistory: () => void;
  getTransactionById: (txId: string) => StoredTransaction | undefined;
  getPendingTransactions: () => StoredTransaction[];
  getRecentTransactions: (limit?: number) => StoredTransaction[];
}

const MAX_HISTORY_SIZE = 100;

/**
 * Generates a block explorer link for a transaction.
 */
function generateExplorerLink(
  txHash: string,
  network: "testnet" | "public" = "testnet",
): string {
  const baseUrl =
    network === "public"
      ? "https://stellar.expert/explorer/public/tx"
      : "https://stellar.expert/explorer/testnet/tx";
  return `${baseUrl}/${txHash}`;
}

/**
 * Converts a TransactionEvent to a StoredTransaction.
 */
function eventToStoredTransaction(event: TransactionEvent): StoredTransaction {
  const { metadata, submission, polling, error } = event;

  const stored: StoredTransaction = {
    id: metadata.id,
    txHash: metadata.txHash,
    state: metadata.state,
    sourceAddress: metadata.sourceAddress,
    contractId: metadata.contractId,
    method: metadata.method,
    createdAt: metadata.createdAt.toISOString(),
    completedAt: metadata.completedAt?.toISOString(),
    error,
  };

  // Add fee if available
  if (submission?.hash) {
    // Fee would be extracted from submission result
    stored.fee = submission.hash ? "100" : undefined; // Placeholder
  }

  // Add ledger if confirmed
  if (polling?.ledger) {
    stored.ledger = polling.ledger;
  }

  // Generate explorer link for successful transactions
  if (metadata.state === "SUCCESS" && metadata.txHash) {
    stored.explorerLink = generateExplorerLink(metadata.txHash);
  }

  return stored;
}

export const useTransactionStore = create<TransactionStoreState>()(
  persist(
    (set, get) => ({
      currentTransaction: null,
      history: [],
      pending: [],
      isProcessing: false,
      processingState: "IDLE",
      error: null,

      setCurrentTransaction: (event) => {
        set({
          currentTransaction: event,
          processingState: event?.type || "IDLE",
          isProcessing: event ? event.type !== "SUCCESS" && event.type !== "FAILED" : false,
        });
      },

      addToHistory: (tx) => {
        set((state) => {
          const updated = [tx, ...state.history];
          // Keep only recent transactions
          if (updated.length > MAX_HISTORY_SIZE) {
            updated.pop();
          }
          return { history: updated };
        });

        // Also add to pending if not completed
        if (tx.state !== "SUCCESS" && tx.state !== "FAILED") {
          set((state) => ({
            pending: [tx, ...state.pending],
          }));
        }
      },

      updatePending: (txId, updates) => {
        set((state) => ({
          pending: state.pending.map((tx) =>
            tx.id === txId ? { ...tx, ...updates } : tx,
          ),
        }));

        // Also update history
        set((state) => ({
          history: state.history.map((tx) =>
            tx.id === txId ? { ...tx, ...updates } : tx,
          ),
        }));
      },

      removePending: (txId) => {
        set((state) => ({
          pending: state.pending.filter((tx) => tx.id !== txId),
        }));
      },

      setProcessing: (isProcessing, state) => {
        set({
          isProcessing,
          processingState: state,
        });
      },

      setError: (error) => {
        set({ error });
      },

      clearHistory: () => {
        set({ history: [], pending: [] });
      },

      getTransactionById: (txId) => {
        const state = get();
        return (
          state.history.find((tx) => tx.id === txId) ||
          state.pending.find((tx) => tx.id === txId)
        );
      },

      getPendingTransactions: () => {
        return get().pending;
      },

      getRecentTransactions: (limit = 10) => {
        return get().history.slice(0, limit);
      },
    }),
    {
      name: "lance-transaction-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        history: state.history,
        pending: state.pending,
      }),
    },
  ),
);

/**
 * Hook to subscribe to transaction store updates.
 * Useful for components that need to react to transaction state changes.
 */
export function useTransactionUpdates(
  callback: (state: TransactionStoreState) => void,
) {
  return useTransactionStore.subscribe(callback);
}
