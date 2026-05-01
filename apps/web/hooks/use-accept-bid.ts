"use client";

import { useCallback, useState } from "react";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

import { api } from "@/lib/api";
import { useTransactionToast } from "@/hooks/use-transaction-toast";
import { useSorobanTransaction } from "@/hooks/use-soroban-transaction";
import { connectWallet, getConnectedWalletAddress } from "@/lib/stellar";

const JOB_REGISTRY_CONTRACT_ID =
  process.env.NEXT_PUBLIC_JOB_REGISTRY_CONTRACT_ID ?? "";

interface AcceptBidParams {
  jobId: string;
  onChainJobId: bigint;
  bidId: string;
  freelancerAddress: string;
}

export function useAcceptBid() {
  const [isAccepting, setIsAccepting] = useState(false);
  const transaction = useSorobanTransaction();
  const { showLoading, updateToSuccess, updateToError } = useTransactionToast();

  const accept = useCallback(
    async (params: AcceptBidParams) => {
      setIsAccepting(true);
      transaction.reset();

      const toastId = showLoading(
        "Accept Bid",
        "Building the Soroban accept_bid transaction for the selected freelancer.",
      );

      let transactionErrorHandled = false;

      try {
        if (!JOB_REGISTRY_CONTRACT_ID) {
          throw new Error("NEXT_PUBLIC_JOB_REGISTRY_CONTRACT_ID is not configured.");
        }

        if (params.onChainJobId <= 0n) {
          throw new Error("This job is not indexed on-chain yet.");
        }

        const clientAddress =
          (await getConnectedWalletAddress()) ?? (await connectWallet());

        const result = await transaction.execute(
          {
            callerAddress: clientAddress,
            contractId: JOB_REGISTRY_CONTRACT_ID,
            method: "accept_bid",
            args: [
              nativeToScVal(params.onChainJobId, { type: "u64" }),
              Address.fromString(clientAddress).toScVal(),
              Address.fromString(params.freelancerAddress).toScVal(),
            ],
          },
          {
            onSuccess: (pipelineResult) => {
              updateToSuccess(
                toastId,
                "Bid Accepted",
                "The client acceptance has been confirmed on-chain.",
                pipelineResult.txHash,
              );
            },
            onError: (error) => {
              transactionErrorHandled = true;
              updateToError(
                toastId,
                "Acceptance Failed",
                error.message,
              );
            },
          },
        );

        if (!result) {
          throw new Error(
            transaction.error ?? "Blockchain acceptance transaction did not complete.",
          );
        }

        const acceptedJob = await api.bids.accept(params.jobId, params.bidId, {
          client_address: clientAddress,
        });

        return { acceptedJob, txHash: result.txHash };
      } catch (error) {
        if (!transactionErrorHandled) {
          updateToError(
            toastId,
            "Acceptance Failed",
            error instanceof Error ? error.message : "Unable to accept the bid.",
          );
        }

        throw error;
      } finally {
        setIsAccepting(false);
      }
    },
    [showLoading, transaction, updateToError, updateToSuccess],
  );

  return {
    accept,
    isAccepting,
    transaction,
  };
}
