"use client";

/**
 * usePostJob – React hook that bridges the XDR builder, transaction status
 * store, and toast notifications into a single cohesive workflow.
 *
 * Usage:
 *   const { submit, isSubmitting } = usePostJob();
 *   await submit({ title, description, budget, ... });
 *
 * The hook:
 *   1. Creates the off-chain job record via the backend API
 *   2. Builds + simulates + signs + submits the on-chain post_job transaction
 *   3. Updates the TxStatusStore for the TransactionTracker component
 *   4. Fires toast notifications at each stage
 *   5. Marks the off-chain job as funded on confirmation
 */

import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { postJobAuto, type PostJobResult, type LifecycleListener } from "@/lib/job-registry";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";
import { useTransactionToast } from "@/hooks/use-transaction-toast";
import { api } from "@/lib/api";
import { connectWallet, getConnectedWalletAddress } from "@/lib/stellar";

export interface PostJobInput {
  title: string;
  description: string;
  budgetUsdc: number;
  milestones: number;
  memo?: string;
  estimatedCompletionDate: string;
  tags: string[];
  skillsRequired: string[];
  estimatedDurationDays?: number;
}

export function usePostJob() {
  const router = useRouter();
  const { setStep, setTxHash, setUnsignedXdr, setSignedXdr, setSimulation, reset } = useTxStatusStore();
  const { showLoading, updateToSuccess, updateToError } = useTransactionToast();

  const mutation = useMutation({
    mutationFn: async (input: PostJobInput) => {
      reset();

      let loadingToast: ReturnType<typeof showLoading> | null = null;

      try {
        // ── Ensure wallet connection ────────────────────────────────────
        const clientAddress =
          (await getConnectedWalletAddress()) ??
          (await connectWallet());

        // ── Step A: Create off-chain job record ─────────────────────────
        loadingToast = showLoading(
          "Creating job record...",
          "Saving your job details to the database",
        );

        const job = await api.jobs.create({
          title: input.title,
          description: input.description,
          budget_usdc: input.budgetUsdc,
          milestones: input.milestones,
          client_address: clientAddress,
          memo: [input.memo, `Estimated completion: ${input.estimatedCompletionDate}`]
            .filter(Boolean)
            .join(" | "),
        });

        // ── Step B: Persist metadata to IPFS and attach hash to the job record ─
        updateToSuccess(
          loadingToast,
          "Job record created",
          "Uploading structured job metadata to IPFS...",
        );

        const metadataResponse = await api.jobs.storeMetadata(job.id, {
          job_id: job.id,
          title: input.title,
          description: input.description,
          budget_usdc: input.budgetUsdc,
          milestones: input.milestones,
          client_address: clientAddress,
          tags: input.tags,
          skills_required: input.skillsRequired,
          estimated_duration_days: input.estimatedDurationDays ?? null,
        });

        const metadataHash = metadataResponse.metadata_hash;
        if (!metadataHash) {
          throw new Error("Failed to resolve job metadata CID before posting on-chain.");
        }

        updateToSuccess(
          loadingToast,
          "Job metadata pinned",
          "Now posting the job to the Stellar blockchain...",
        );

        // Build lifecycle listener that updates store + toasts
        const onStep: LifecycleListener = (step, detail, metadata) => {
          setStep(step, detail);

          if (metadata?.rawXdr) {
            if (step === "building" || step === "simulating") {
              setUnsignedXdr(metadata.rawXdr);
            } else if (step === "signing" || step === "submitting" || step === "confirming" || step === "confirmed") {
              setSignedXdr(metadata.rawXdr);
            }
          }

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

        // Convert USDC to stroops (1 USDC = 10,000,000 stroops)
        const budgetStroops = BigInt(input.budgetUsdc);

        const result: PostJobResult = await postJobAuto(
          clientAddress,
          metadataHash,
          budgetStroops,
          onStep,
        );

        // ── Step C: Update store with simulation diagnostics ────────────
        setTxHash(result.txHash);
        setSimulation(result.simulation);

        // ── Step D: Mark off-chain job as funded ────────────────────────
        try {
          await api.jobs.markFunded(job.id, {
            client_address: clientAddress,
          });
        } catch {
          // Non-critical: on-chain tx succeeded, off-chain update is best-effort
          console.warn("Failed to mark job as funded in backend");
        }

        // ── Success ─────────────────────────────────────────────────────
        updateToSuccess(
          loadingToast,
          "Job posted on-chain!",
          `Transaction ${result.txHash.slice(0, 12)}... confirmed`,
          result.txHash,
        );

        // Navigate to the job detail page
        router.push(`/jobs/${job.id}`);

        return { job, result };
      } catch (error) {
        setStep("failed", error instanceof Error ? error.message : String(error));
        updateToError(
          loadingToast ?? showLoading("Processing..."),
          "Transaction failed",
          error instanceof Error ? error.message : "An unexpected error occurred",
        );
        throw error;
      }
    },
  });

  return {
    submit: mutation.mutateAsync,
    isSubmitting: mutation.isPending,
  };
}
