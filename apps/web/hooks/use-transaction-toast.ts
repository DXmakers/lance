"use client";

import { useCallback } from "react";
import { toast, type ToastState } from "@/lib/toast";
import { mapErrorToToast } from "@/lib/error-mapper";

export interface TransactionCallbacks {
  onSuccess?: (txHash: string) => void;
  onError?: (error: Error) => void;
}

export interface TransactionConfig {
  loadingMessage?: string;
  successMessage?: string;
  errorMessage?: string;
}

export function useTransactionToast() {
  const executeTransaction = useCallback(
    async <T extends { txHash?: string }>(
      operation: () => Promise<T>,
      config: TransactionConfig = {},
      callbacks?: TransactionCallbacks
    ): Promise<T | null> => {
      const {
        loadingMessage = "Processing transaction...",
        successMessage = "Transaction completed successfully",
        errorMessage = "Transaction failed",
      } = config;

      const loadingToast = toast.loading({
        title: loadingMessage,
        description: "Please wait while we confirm your transaction on the Stellar network",
      });

      try {
        const result = await operation();

        toast.update(loadingToast, "success", {
          title: successMessage,
          description: "Your transaction has been confirmed on the blockchain",
          txHash: result.txHash,
        });

        if (result.txHash && callbacks?.onSuccess) {
          callbacks.onSuccess(result.txHash);
        }

        return result;
      } catch (error) {
        const errorToast = mapErrorToToast(error);

        toast.update(loadingToast, "error", {
          title: errorToast.title || errorMessage,
          description: errorToast.description,
        });

        if (callbacks?.onError && error instanceof Error) {
          callbacks.onError(error);
        }

        return null;
      }
    },
    []
  );

  const showLoading = useCallback((title: string, description?: string): ToastState => {
    return toast.loading({ title, description });
  }, []);

  const updateToSuccess = useCallback(
    (
      state: ToastState,
      title: string,
      description?: string,
      txHash?: string
    ): void => {
      toast.update(state, "success", { title, description, txHash });
    },
    []
  );

  const updateToError = useCallback(
    (state: ToastState, title: string, description?: string): void => {
      toast.update(state, "error", { title, description });
    },
    []
  );

  const dismiss = useCallback((state: ToastState): void => {
    toast.dismiss(state);
  }, []);

  return {
    executeTransaction,
    showLoading,
    updateToSuccess,
    updateToError,
    dismiss,
  };
}
