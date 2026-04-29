"use client";

import { useCallback, useState } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

import { api } from "@/lib/api";
import { useTransactionToast } from "@/hooks/use-transaction-toast";
import { useSorobanTransaction } from "@/hooks/use-soroban-transaction";
import { connectWallet, getConnectedWalletAddress } from "@/lib/stellar";

const JOB_REGISTRY_CONTRACT_ID =
  process.env.NEXT_PUBLIC_JOB_REGISTRY_CONTRACT_ID ?? "";

interface SubmitBidParams {
  jobId: string;
  onChainJobId: bigint;
  proposal: string;
}

/**
 * Submits a bid through the shared Soroban transaction pipeline so the UI
 * gets simulation output, fee breakdowns, signature state, and confirmation
 * updates from one source of truth.
 */
export function useSubmitBid() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const transaction = useSorobanTransaction();
  const { showLoading, updateToSuccess, updateToError } = useTransactionToast();

  const submit = useCallback(
    async (params: SubmitBidParams) => {
      setIsSubmitting(true);
      transaction.reset();

      const toastId = showLoading(
        "Sign & Submit Bid",
        "Saving your proposal and simulating the Soroban transaction.",
      );

      let transactionErrorHandled = false;

      try {
        if (!JOB_REGISTRY_CONTRACT_ID) {
          throw new Error("NEXT_PUBLIC_JOB_REGISTRY_CONTRACT_ID is not configured.");
        }

        if (params.onChainJobId <= 0n) {
          throw new Error(
            "This job is not indexed on-chain yet. Wait for the indexer to catch up and try again.",
          );
        }

        const freelancerAddress =
          (await getConnectedWalletAddress()) ?? (await connectWallet());

        const bid = await api.bids.create(params.jobId, {
          freelancer_address: freelancerAddress,
          proposal: params.proposal,
        });

        const result = await transaction.execute(
          {
            callerAddress: freelancerAddress,
            contractId: JOB_REGISTRY_CONTRACT_ID,
            method: "submit_bid",
            args: [
              nativeToScVal(params.onChainJobId, { type: "u64" }),
              Address.fromString(freelancerAddress).toScVal(),
              nativeToScVal(new TextEncoder().encode(params.proposal), {
                type: "bytes",
              }),
            ],
          },
          {
            onSuccess: (pipelineResult) => {
              updateToSuccess(
                toastId,
                "Bid Confirmed",
                "Your proposal is confirmed on-chain and ready for immediate UI refresh.",
                pipelineResult.txHash,
              );
            },
            onError: (error) => {
              transactionErrorHandled = true;
              updateToError(
                toastId,
                "Submission Failed",
                error.message,
              );
            },
          },
        );

        if (!result) {
          throw new Error(
            transaction.error ?? "Blockchain transaction did not complete.",
          );
        }

        return { bid, txHash: result.txHash };
      } catch (error) {
        if (!transactionErrorHandled) {
          updateToError(
            toastId,
            "Submission Failed",
            error instanceof Error ? error.message : "Blockchain transaction failed.",
          );
        }

        throw error;
      } finally {
        setIsSubmitting(false);
      }
    },
    [showLoading, transaction, updateToError, updateToSuccess],
  );

  return {
    submit,
    isSubmitting,
    transaction,
  };
}
