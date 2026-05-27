/**
 * useTransactionModal – React hook for managing TransactionStatusModal state
 * 
 * Provides a clean API for opening/closing the modal and integrating with
 * the transaction lifecycle. Works seamlessly with existing hooks like
 * usePostJob and useSubmitBid.
 * 
 * Usage:
 *   const { openModal, closeModal, isModalOpen } = useTransactionModal();
 *   
 *   const handleTransaction = async () => {
 *     openModal();
 *     try {
 *       await postJob(...);
 *     } catch (error) {
 *       // Modal will show error state
 *     }
 *   };
 */

"use client";

import { useState, useCallback, useEffect } from "react";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";
import type { TxLifecycleStep } from "@/lib/job-registry";

export interface TransactionModalOptions {
  /** Auto-open modal when transaction starts (default: false) */
  autoOpen?: boolean;
  /** Auto-close modal after successful transaction (default: false) */
  autoCloseOnSuccess?: boolean;
  /** Delay before auto-closing on success (ms, default: 3000) */
  autoCloseDelay?: number;
  /** Callback when modal opens */
  onOpen?: () => void;
  /** Callback when modal closes */
  onClose?: () => void;
  /** Callback when transaction succeeds */
  onSuccess?: (txHash: string) => void;
  /** Callback when transaction fails */
  onError?: (error: string) => void;
}

export function useTransactionModal(options: TransactionModalOptions = {}) {
  const {
    autoOpen = false,
    autoCloseOnSuccess = false,
    autoCloseDelay = 3000,
    onOpen,
    onClose,
    onSuccess,
    onError,
  } = options;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const { step, txHash, detail, reset } = useTxStatusStore();

  // ── Auto-open when transaction starts ──────────────────────────────────
  useEffect(() => {
    if (autoOpen && step === "building" && !isModalOpen) {
      openModal();
    }
  }, [autoOpen, step, isModalOpen]);

  // ── Auto-close on success ──────────────────────────────────────────────
  useEffect(() => {
    if (autoCloseOnSuccess && step === "confirmed" && isModalOpen) {
      const timer = setTimeout(() => {
        closeModal();
      }, autoCloseDelay);

      return () => clearTimeout(timer);
    }
  }, [autoCloseOnSuccess, step, isModalOpen, autoCloseDelay]);

  // ── Success callback ───────────────────────────────────────────────────
  useEffect(() => {
    if (step === "confirmed" && txHash && onSuccess) {
      onSuccess(txHash);
    }
  }, [step, txHash, onSuccess]);

  // ── Error callback ─────────────────────────────────────────────────────
  useEffect(() => {
    if (step === "failed" && detail && onError) {
      onError(detail);
    }
  }, [step, detail, onError]);

  // ── Open modal ─────────────────────────────────────────────────────────
  const openModal = useCallback(() => {
    setIsModalOpen(true);
    onOpen?.();
  }, [onOpen]);

  // ── Close modal ────────────────────────────────────────────────────────
  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    onClose?.();
  }, [onClose]);

  // ── Reset and open ─────────────────────────────────────────────────────
  const resetAndOpen = useCallback(() => {
    reset();
    openModal();
  }, [reset, openModal]);

  // ── Check if transaction is active ─────────────────────────────────────
  const isTransactionActive = 
    step !== "idle" && 
    step !== "confirmed" && 
    step !== "failed";

  return {
    isModalOpen,
    openModal,
    closeModal,
    resetAndOpen,
    isTransactionActive,
    currentStep: step,
    txHash,
    error: step === "failed" ? detail : null,
  };
}

// ─── Convenience Hooks ──────────────────────────────────────────────────────

/**
 * useTransactionModalWithAutoOpen – Auto-opens modal when transaction starts
 */
export function useTransactionModalWithAutoOpen(
  options?: Omit<TransactionModalOptions, "autoOpen">
) {
  return useTransactionModal({ ...options, autoOpen: true });
}

/**
 * useTransactionModalWithAutoClose – Auto-closes modal after success
 */
export function useTransactionModalWithAutoClose(
  options?: Omit<TransactionModalOptions, "autoCloseOnSuccess">
) {
  return useTransactionModal({ ...options, autoCloseOnSuccess: true });
}

/**
 * useTransactionModalWithCallbacks – Provides success/error callbacks
 */
export function useTransactionModalWithCallbacks(
  onSuccess: (txHash: string) => void,
  onError: (error: string) => void,
  options?: Omit<TransactionModalOptions, "onSuccess" | "onError">
) {
  return useTransactionModal({ ...options, onSuccess, onError });
}

// ─── Helper Hook for Step Monitoring ────────────────────────────────────────

/**
 * useTransactionStep – Monitor current transaction step
 */
export function useTransactionStep() {
  const { step, detail } = useTxStatusStore();
  
  return {
    step,
    detail,
    isIdle: step === "idle",
    isBuilding: step === "building",
    isSimulating: step === "simulating",
    isSigning: step === "signing",
    isSubmitting: step === "submitting",
    isConfirming: step === "confirming",
    isConfirmed: step === "confirmed",
    isFailed: step === "failed",
    isActive: step !== "idle" && step !== "confirmed" && step !== "failed",
  };
}

// ─── Helper Hook for Transaction Progress ───────────────────────────────────

/**
 * useTransactionProgress – Get transaction progress percentage
 */
export function useTransactionProgress() {
  const { step } = useTxStatusStore();

  const stepToProgress: Record<TxLifecycleStep, number> = {
    idle: 0,
    building: 20,
    simulating: 40,
    signing: 60,
    submitting: 80,
    confirming: 90,
    confirmed: 100,
    failed: 0,
  };

  return {
    progress: stepToProgress[step],
    isComplete: step === "confirmed",
    isFailed: step === "failed",
  };
}
