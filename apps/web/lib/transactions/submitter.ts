/**
 * submitter.ts
 *
 * Transaction submission with async RPC polling and Horizon fallback support.
 * Handles sequence number mismatch errors with account refresh and resubmission.
 * Implements comprehensive retry logic with max 3 attempts for network failures.
 */

import { Transaction, Account } from "@stellar/stellar-sdk";
import { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { sorobanServer, getAccountState } from "../stellar";
import { submitToHorizon } from "./horizon-fallback";
import { pollTransactionStatus, PollingResult } from "./poller";

export interface SubmissionConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Delay between retries in milliseconds (default: 1000) */
  retryDelayMs?: number;
  /** Polling timeout in milliseconds (default: 120000) */
  pollingTimeoutMs?: number;
}

export interface SubmissionResult {
  hash: string;
  status: "SUCCESS" | "FAILED" | "TIMEOUT" | "ERROR";
  resultXdr?: string;
  ledger?: number;
  createdAt?: string;
  error?: string;
  retriesUsed: number;
}

/**
 * Submits a signed transaction to Soroban RPC with retry logic and Horizon fallback.
 * Handles sequence number mismatch by refreshing account and resubmitting.
 *
 * Submission flow:
 * 1. Submit to Soroban RPC (primary)
 * 2. On sequence mismatch: refresh account, rebuild, resubmit (up to 3 attempts)
 * 3. On RPC failure: fallback to Horizon submission
 * 4. Poll transaction status with exponential backoff
 *
 * @param signedTx - The signed transaction to submit
 * @param sourceAddress - Source account address (for sequence mismatch recovery)
 * @param config - Optional submission configuration
 * @returns SubmissionResult with transaction hash, status, and details
 */
export async function submitTransaction(
  signedTx: Transaction,
  sourceAddress: string,
  config: SubmissionConfig = {},
): Promise<SubmissionResult> {
  const maxRetries = config.maxRetries ?? 3;
  const retryDelayMs = config.retryDelayMs ?? 1000;
  const pollingTimeoutMs = config.pollingTimeoutMs ?? 120000;

  let retriesUsed = 0;
  let lastError: Error | null = null;

  // Attempt submission with retry logic
  while (retriesUsed < maxRetries) {
    try {
      // Submit to Soroban RPC
      const submitResult = await sorobanServer.sendTransaction(signedTx);

      if (submitResult.status === "ERROR") {
        const isSeqMismatch = isSequenceNumberMismatch(submitResult.errorResult);

        if (isSeqMismatch && retriesUsed < maxRetries - 1) {
          // Sequence mismatch: refresh account and retry
          if (process.env.NODE_ENV === "development") {
            console.warn(
              `[submitter] Sequence number mismatch, retrying (attempt ${retriesUsed + 1}/${maxRetries})`,
            );
          }

          retriesUsed++;
          await sleep(retryDelayMs);

          // Refresh account state and rebuild transaction
          try {
            const freshAccount = await getAccountState(sourceAddress);
            const rebuiltTx = rebuildTransaction(signedTx, freshAccount);
            // Continue loop with rebuilt transaction
            Object.assign(signedTx, rebuiltTx);
            continue;
          } catch (refreshError) {
            lastError = new Error(
              `Failed to refresh account for retry: ${refreshError}`,
            );
            break;
          }
        }

        // Non-recoverable error or max retries reached
        lastError = new Error(
          `RPC submission error: ${submitResult.errorResult || "unknown error"}`,
        );
        break;
      }

      // Successful submission to RPC
      const txHash = submitResult.hash;

      if (process.env.NODE_ENV === "development") {
        console.log(`[submitter] Transaction submitted to RPC: ${txHash}`);
      }

      // Poll for confirmation
      const pollingResult = await pollTransactionStatus(txHash, {
        timeoutMs: pollingTimeoutMs,
      });

      return {
        hash: txHash,
        status: pollingResult.status,
        resultXdr: pollingResult.resultXdr,
        ledger: pollingResult.ledger,
        createdAt: pollingResult.createdAt,
        retriesUsed,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (retriesUsed < maxRetries - 1) {
        if (process.env.NODE_ENV === "development") {
          console.warn(
            `[submitter] RPC submission failed, retrying (attempt ${retriesUsed + 1}/${maxRetries}): ${lastError.message}`,
          );
        }

        retriesUsed++;
        await sleep(retryDelayMs);
        continue;
      }

      // Max retries reached, try Horizon fallback
      break;
    }
  }

  // Fallback to Horizon submission
  if (process.env.NODE_ENV === "development") {
    console.warn(
      `[submitter] RPC submission exhausted, attempting Horizon fallback`,
    );
  }

  try {
    const horizonResult = await submitToHorizon(signedTx);

    if (horizonResult.status === "error") {
      return {
        hash: horizonResult.hash || "",
        status: "ERROR",
        error: horizonResult.errorMessage || "Horizon submission failed",
        retriesUsed,
      };
    }

    // Horizon submission successful, poll for confirmation
    const pollingResult = await pollTransactionStatus(horizonResult.hash, {
      timeoutMs: pollingTimeoutMs,
    });

    return {
      hash: horizonResult.hash,
      status: pollingResult.status,
      resultXdr: pollingResult.resultXdr,
      ledger: pollingResult.ledger,
      createdAt: pollingResult.createdAt,
      retriesUsed,
    };
  } catch (horizonError) {
    const horizonErrorMsg =
      horizonError instanceof Error
        ? horizonError.message
        : "Unknown Horizon error";

    return {
      hash: "",
      status: "ERROR",
      error: `Both RPC and Horizon submission failed. Last error: ${lastError?.message || horizonErrorMsg}`,
      retriesUsed,
    };
  }
}

/**
 * Checks if an error result indicates a sequence number mismatch.
 *
 * @param errorResult - The error result from RPC submission
 * @returns true if sequence number mismatch, false otherwise
 */
function isSequenceNumberMismatch(
  errorResult: unknown,
): boolean {
  if (!errorResult) return false;

  try {
    // errorResult is an xdr.TransactionResult object
    const result = (errorResult as { result?: () => { name?: string } }).result?.();
    if (result?.name === "txBadSeq") {
      return true;
    }
  } catch {
    // Ignore parsing errors
  }

  // Fallback: check error message string
  const errorStr = String(errorResult);
  return (
    errorStr.includes("txBadSeq") ||
    errorStr.includes("bad_seq") ||
    errorStr.includes("sequence")
  );
}

/**
 * Rebuilds a transaction with a fresh account sequence number.
 * Used for sequence number mismatch recovery.
 *
 * @param originalTx - The original transaction
 * @param freshAccount - The fresh account with updated sequence number
 * @returns A new transaction with updated sequence number
 */
function rebuildTransaction(
  originalTx: Transaction,
  freshAccount: Account,
): Transaction {
  // Create a new transaction with the same operations but fresh sequence number
  const txBuilder = new (require("@stellar/stellar-sdk")).TransactionBuilder(
    freshAccount,
    {
      fee: originalTx.fee,
      networkPassphrase: originalTx.networkPassphrase,
    },
  );

  // Copy operations from original transaction
  const operations = originalTx.operations;
  for (const op of operations) {
    txBuilder.addOperation(op);
  }

  // Copy timebounds
  if (originalTx.timebounds) {
    txBuilder.setTimebounds(
      originalTx.timebounds.minTime,
      originalTx.timebounds.maxTime,
    );
  }

  return txBuilder.build();
}

/**
 * Sleep utility for retry delays.
 *
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Submits a transaction and waits for confirmation.
 * Simplified interface that returns true on success, false on failure.
 *
 * @param signedTx - The signed transaction to submit
 * @param sourceAddress - Source account address
 * @param timeoutMs - Polling timeout in milliseconds
 * @returns true if transaction succeeded, false otherwise
 */
export async function submitAndWait(
  signedTx: Transaction,
  sourceAddress: string,
  timeoutMs: number = 120000,
): Promise<boolean> {
  const result = await submitTransaction(signedTx, sourceAddress, {
    pollingTimeoutMs: timeoutMs,
  });
  return result.status === "SUCCESS";
}
