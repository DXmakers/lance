/**
 * poller.ts
 *
 * Transaction status polling with exponential backoff and Horizon fallback.
 * Polls transaction status using getTransactionStatus() with exponential backoff.
 * Polling schedule: interval starts at 1 second, max 30 seconds, timeout 120 seconds.
 */

import { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { sorobanServer } from "../stellar";
import { getHorizonTransactionStatus } from "./horizon-fallback";

export interface PollingConfig {
  /** Initial polling interval in milliseconds (default: 1000) */
  initialIntervalMs?: number;
  /** Maximum polling interval in milliseconds (default: 30000) */
  maxIntervalMs?: number;
  /** Total timeout in milliseconds (default: 120000) */
  timeoutMs?: number;
}

export interface PollingResult {
  hash: string;
  status: "SUCCESS" | "FAILED" | "NOT_FOUND" | "TIMEOUT";
  resultXdr?: string;
  ledger?: number;
  createdAt?: string;
}

/**
 * Polls transaction status using Soroban RPC with exponential backoff.
 * Falls back to Horizon if RPC polling fails.
 *
 * Polling schedule:
 * - Starts at 1 second interval
 * - Increases exponentially (1s, 2s, 4s, 8s, 16s, 30s, 30s, ...)
 * - Maximum interval: 30 seconds
 * - Total timeout: 120 seconds
 *
 * @param txHash - Transaction hash to poll
 * @param config - Optional polling configuration
 * @returns PollingResult with transaction status and details
 */
export async function pollTransactionStatus(
  txHash: string,
  config: PollingConfig = {},
): Promise<PollingResult> {
  const initialIntervalMs = config.initialIntervalMs ?? 1000;
  const maxIntervalMs = config.maxIntervalMs ?? 30000;
  const timeoutMs = config.timeoutMs ?? 120000;

  let elapsedMs = 0;
  let currentIntervalMs = initialIntervalMs;
  let useHorizonFallback = false;

  while (elapsedMs < timeoutMs) {
    try {
      // Try Soroban RPC first
      if (!useHorizonFallback) {
        const response = await sorobanServer.getTransaction(txHash);

        if (response.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
          return {
            hash: txHash,
            status: "SUCCESS",
            resultXdr: response.resultXdr ? String(response.resultXdr) : undefined,
            ledger: response.ledger,
            createdAt: response.createdAt ? String(response.createdAt) : undefined,
          };
        }

        if (response.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
          return {
            hash: txHash,
            status: "FAILED",
            resultXdr: response.resultXdr ? String(response.resultXdr) : undefined,
            ledger: response.ledger,
            createdAt: response.createdAt ? String(response.createdAt) : undefined,
          };
        }

        // status === NOT_FOUND, continue polling
      } else {
        // Use Horizon fallback
        const horizonTx = await getHorizonTransactionStatus(txHash);

        if (horizonTx) {
          // Transaction found on Horizon
          return {
            hash: txHash,
            status: horizonTx.successful ? "SUCCESS" : "FAILED",
            resultXdr: horizonTx.result_xdr,
            ledger: horizonTx.ledger_attr,
            createdAt: horizonTx.created_at,
          };
        }

        // Transaction not found on Horizon, continue polling
      }
    } catch (error) {
      // RPC error, try Horizon fallback on next iteration
      if (!useHorizonFallback) {
        if (process.env.NODE_ENV === "development") {
          console.warn(
            `[poller] Soroban RPC error, switching to Horizon fallback: ${error}`,
          );
        }
        useHorizonFallback = true;
        // Reset interval for Horizon polling
        currentIntervalMs = initialIntervalMs;
      } else {
        // Both RPC and Horizon failed, continue polling
        if (process.env.NODE_ENV === "development") {
          console.warn(`[poller] Horizon fallback error: ${error}`);
        }
      }
    }

    // Wait before next poll with exponential backoff
    await sleep(currentIntervalMs);
    elapsedMs += currentIntervalMs;

    // Increase interval exponentially, capped at maxIntervalMs
    currentIntervalMs = Math.min(currentIntervalMs * 2, maxIntervalMs);
  }

  // Timeout reached
  return {
    hash: txHash,
    status: "TIMEOUT",
  };
}

/**
 * Polls transaction status with a simpler interface.
 * Returns true if transaction succeeded, false if failed or timed out.
 *
 * @param txHash - Transaction hash to poll
 * @param timeoutMs - Timeout in milliseconds (default: 120000)
 * @returns true if SUCCESS, false otherwise
 */
export async function waitForTransactionSuccess(
  txHash: string,
  timeoutMs: number = 120000,
): Promise<boolean> {
  const result = await pollTransactionStatus(txHash, { timeoutMs });
  return result.status === "SUCCESS";
}

/**
 * Sleep utility for polling delays.
 *
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
