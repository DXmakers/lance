"use client";

/**
 * useSubmitBid – React hook that bridges the XDR builder for job_registry.submit_bid,
 * transaction status store, and toast notifications.
 *
 * Pipeline: Create off-chain bid -> Build/Simulate/Sign/Submit/Confirm on-chain transaction.
 */

import { useCallback, useState } from "react";
import { submitBid, type SubmitBidResult, type LifecycleListener } from "@/lib/job-registry";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";
import { useTransactionToast } from "@/hooks/use-transaction-toast";
import { api } from "@/lib/api";
import { connectWallet, getConnectedWalletAddress } from "@/lib/stellar";

export interface SubmitBidInput {
  jobId: string; // Off-chain UUID
  onChainJobId: bigint;
  proposal: string;
}

export function useSubmitBid() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { setStep, setTxHash, setRawXdr, setSimulation, reset } = useTxStatusStore();
  const { showLoading, updateToSuccess, updateToError } = useTransactionToast();

  const submit = useCallback(
    async (input: SubmitBidInput) => {
      setIsSubmitting(true);
      reset();

      let loadingToast: ReturnType<typeof showLoading> | null = null;

      try {
        // ── Ensure wallet connection ────────────────────────────────────
        const freelancerAddress =
          (await getConnectedWalletAddress()) ??
          (await connectWallet());

        // ── Step A: Create off-chain bid record ─────────────────────────
        loadingToast = showLoading(
          "Creating bid record...",
          "Saving your proposal to the database",
        );

        const bid = await api.bids.create(input.jobId, {
          freelancer_address: freelancerAddress,
          proposal: input.proposal,
        });

        // ── Step B: Submit on-chain submit_bid transaction ──────────────
        updateToSuccess(
          loadingToast,
          "Bid record created",
          "Now submitting to the Stellar blockchain...",
        );

        // Build lifecycle listener that updates store + toasts
        const onStep: LifecycleListener = (step, detail, metadata) => {
          setStep(step, detail);
          if (metadata?.rawXdr) setRawXdr(metadata.rawXdr);

          // Capture tx hash when available
          if (step === "confirming" && detail) {
            setTxHash(detail);
          }

          // Update toast for key milestones
          if (step === "signing") {
            showLoading(
              "Waiting for signature...",
              "Please approve the transaction in your wallet",
            );
          }
        };

        // Use the bid ID as a metadata hash/CID-like identifier
        const proposalHash = `bid-${bid.id}`;

        const result: SubmitBidResult = await submitBid(
          {
            jobId: input.onChainJobId,
            freelancerAddress,
            proposalHash,
          },
          onStep,
        );

        // ── Step C: Update store with simulation diagnostics ────────────
        setTxHash(result.txHash);
        setSimulation(result.simulation);

        // ── Success ─────────────────────────────────────────────────────
        updateToSuccess(
          loadingToast,
          "Bid submitted on-chain!",
          `Transaction ${result.txHash.slice(0, 12)}... confirmed`,
          result.txHash,
        );

        return { bid, result };
      } catch (error) {
        setStep("failed", error instanceof Error ? error.message : String(error));
        updateToError(
          loadingToast ?? showLoading("Processing..."),
          "Transaction failed",
          error instanceof Error ? error.message : "An unexpected error occurred",
        );
        throw error;
      } finally {
        setIsSubmitting(false);
      }
    },
    [reset, setStep, setTxHash, setSimulation, showLoading, updateToSuccess, updateToError],
  );

  return {
    submit,
    isSubmitting,
  };
}
