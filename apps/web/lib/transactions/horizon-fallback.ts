/**
 * horizon-fallback.ts
 *
 * Horizon fallback submission for transactions when Soroban RPC is unavailable.
 * Provides submitToHorizon() method using Horizon.sendTransaction().
 */

import { Transaction, Horizon } from "@stellar/stellar-sdk";
import { horizonServer } from "../stellar";

export interface HorizonSubmissionResult {
  hash: string;
  status: "pending" | "error";
  errorMessage?: string;
}

/**
 * Submits a signed transaction to Horizon as a fallback when Soroban RPC fails.
 * Horizon provides basic transaction submission but does not support Soroban operations directly.
 * This is used as a last-resort fallback for network resilience.
 *
 * @param signedTx - The signed transaction to submit
 * @returns HorizonSubmissionResult with transaction hash and status
 * @throws Error if submission fails
 */
export async function submitToHorizon(
  signedTx: Transaction,
): Promise<HorizonSubmissionResult> {
  try {
    const response = await horizonServer.submitTransaction(signedTx);

    // Horizon returns a successful response with hash when accepted
    if (response.hash) {
      return {
        hash: response.hash,
        status: "pending",
      };
    }

    // If no hash but no error, treat as pending
    return {
      hash: response.id || "",
      status: "pending",
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown Horizon submission error";

    // Check for specific Horizon error types
    if (error instanceof Horizon.TransactionFailedError) {
      return {
        hash: error.hash || "",
        status: "error",
        errorMessage: `Transaction failed: ${error.resultXdr}`,
      };
    }

    if (error instanceof Horizon.BadRequestError) {
      return {
        hash: "",
        status: "error",
        errorMessage: `Bad request: ${errorMessage}`,
      };
    }

    if (error instanceof Horizon.BadResponseError) {
      return {
        hash: "",
        status: "error",
        errorMessage: `Bad response from Horizon: ${errorMessage}`,
      };
    }

    return {
      hash: "",
      status: "error",
      errorMessage: `Horizon submission failed: ${errorMessage}`,
    };
  }
}

/**
 * Checks if a transaction exists on Horizon by hash.
 * Used to verify transaction status when polling.
 *
 * @param txHash - The transaction hash to check
 * @returns Transaction details if found, null if not found
 */
export async function getHorizonTransactionStatus(
  txHash: string,
): Promise<Horizon.ServerApi.TransactionRecord | null> {
  try {
    const tx = await horizonServer.transactions().transaction(txHash).call();
    return tx;
  } catch (error) {
    // Transaction not found or other error
    if (error instanceof Horizon.NotFoundError) {
      return null;
    }
    throw error;
  }
}
