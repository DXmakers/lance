"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import {
  submitBid,
  type SubmitBidParams,
  type LifecycleListener,
} from "@/lib/job-registry";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";
import { useTransactionToast } from "@/hooks/use-transaction-toast";
import { connectWallet, getConnectedWalletAddress } from "@/lib/stellar";

/**
 * Hook to manage the lifecycle of submitting a bid to the job registry.
 *
 * Flow:
 * 1. Create off-chain record via API (status: pending)
 * 2. Build, Simulate, Sign, Submit, Confirm on-chain transaction
 * 3. Update UI/Toasts accordingly
 */
export function useSubmitBid() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { setStep, setTxHash, setRawXdr, setSimulation, reset } = useTxStatusStore();
  const { showLoading, updateToSuccess, updateToError } = useTransactionToast();

  const submit = useCallback(
    async (params: { jobId: string; onChainJobId: bigint; proposal: string }) => {
      setIsSubmitting(true);
      reset();

      const toastId = showLoading(
        "Submitting Bid",
        "Preparing your proposal for the blockchain...",
      );

      try {
        // ─── Step 1: Off-chain Record ─────────────────────────────────────
        // We create the bid record first so internal systems can track it.
        // If the on-chain TX fails, the record remains in a 'pending' or 'failed' state.
        const bid = await api.bids.create(params.jobId, {
          freelancer_address: "PENDING_ON_CHAIN", // Will be updated by indexer
          proposal: params.proposal,
        });

        // ─── Step 2: On-chain Transaction ─────────────────────────────────
        // build lifecycle listener that updates store + toasts
        const onStep: LifecycleListener = (step, detail, metadata) => {
          setStep(step, detail);
          if (metadata?.rawXdr) setRawXdr(metadata.rawXdr);

          // Capture tx hash when available
          if (step === "confirming" && detail) {
            setTxHash(detail);
          }
        };

        // ── Step 1.5: Wallet Address ─────────────────────────────────────
        const freelancer = (await getConnectedWalletAddress()) ?? (await connectWallet());

        const result = await submitBid(
          {
            jobId: params.onChainJobId,
            freelancerAddress: freelancer,
            proposalHash: params.proposal,
          },
          onStep,
        );

        // ─── Step 3: Success ──────────────────────────────────────────────
        setSimulation(result.simulation);
        updateToSuccess(
          toastId,
          "Bid Submitted",
          "Your proposal has been recorded on the Stellar network.",
        );

        return { bid, txHash: result.txHash };
      } catch (error) {
        setStep("failed", error instanceof Error ? error.message : "Unknown error");
        updateToError(
          toastId,
          "Submission Failed",
          error instanceof Error ? error.message : "Blockchain transaction failed.",
        );
        throw error;
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      reset,
      setStep,
      setTxHash,
      setRawXdr,
      setSimulation,
      showLoading,
      updateToSuccess,
      updateToError,
    ],
  );

  return {
    submit,
    isSubmitting,
  };
}
