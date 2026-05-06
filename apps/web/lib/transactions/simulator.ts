/**
 * simulator.ts
 *
 * Robust transaction simulation for Soroban contract calls.
 * Estimates fees and predicts success before user signing.
 *
 * Features:
 * - Calls simulateTransaction() on Soroban RPC
 * - Parses simulation results (minResourceFee, instructions, readBytes, writeBytes)
 * - Validates simulation success (detects errors like IngressExpiration, InvalidAction)
 * - Graceful error handling with user-friendly messages
 * - Caching with 5-second TTL for identical payloads
 */

import { Transaction, xdr } from "@stellar/stellar-sdk";
import { Server as SorobanServer, Api } from "@stellar/stellar-sdk/rpc";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SimulationResult {
  /** Minimum resource fee in stroops */
  minResourceFee: string;
  /** CPU instructions consumed */
  cpuInstructions: string;
  /** Memory bytes consumed */
  memoryBytes: string;
  /** Ledger read bytes */
  readBytes: number;
  /** Ledger write bytes */
  writeBytes: number;
  /** Raw simulation response (for debugging) */
  raw?: Api.SimulateTransactionResponse;
}

export interface SimulationError {
  /** Error type (e.g., "IngressExpiration", "InvalidAction") */
  type: string;
  /** Human-readable error message */
  message: string;
  /** Raw error details */
  details?: unknown;
}

export interface SimulationCacheEntry {
  result: SimulationResult;
  timestamp: number;
}

// ─── Cache Configuration ──────────────────────────────────────────────────────

const CACHE_TTL_MS = 5000; // 5 seconds
const simulationCache = new Map<string, SimulationCacheEntry>();

/**
 * Generates a cache key from transaction XDR.
 * Uses a simple hash of the XDR string for cache lookup.
 */
function generateCacheKey(transactionXdr: string): string {
  // Simple hash function for cache key
  let hash = 0;
  for (let i = 0; i < transactionXdr.length; i++) {
    const char = transactionXdr.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `sim_${Math.abs(hash).toString(36)}`;
}

/**
 * Clears expired cache entries.
 */
function clearExpiredCache(): void {
  const now = Date.now();
  for (const [key, entry] of simulationCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      simulationCache.delete(key);
    }
  }
}

/**
 * Gets a cached simulation result if available and not expired.
 */
function getCachedSimulation(transactionXdr: string): SimulationResult | null {
  clearExpiredCache();
  const key = generateCacheKey(transactionXdr);
  const entry = simulationCache.get(key);

  if (!entry) {
    return null;
  }

  const age = Date.now() - entry.timestamp;
  if (age > CACHE_TTL_MS) {
    simulationCache.delete(key);
    return null;
  }

  return entry.result;
}

/**
 * Caches a simulation result.
 */
function cacheSimulation(transactionXdr: string, result: SimulationResult): void {
  const key = generateCacheKey(transactionXdr);
  simulationCache.set(key, {
    result,
    timestamp: Date.now(),
  });
}

// ─── Simulation Logic ─────────────────────────────────────────────────────────

/**
 * Simulates a transaction on the Soroban RPC endpoint.
 * Extracts resource fees and validates success.
 *
 * @param rpc - Soroban RPC server instance
 * @param transaction - Unsigned transaction to simulate
 * @param useCache - Whether to use cached results (default: true)
 * @returns Simulation result with fees and resource usage
 * @throws SimulationError if simulation fails
 */
export async function simulateTransaction(
  rpc: SorobanServer,
  transaction: Transaction,
  useCache: boolean = true,
): Promise<SimulationResult> {
  const transactionXdr = transaction.toXDR();

  // Check cache first
  if (useCache) {
    const cached = getCachedSimulation(transactionXdr);
    if (cached) {
      return cached;
    }
  }

  // Call RPC simulateTransaction
  let simResult: Api.SimulateTransactionResponse;
  try {
    simResult = await rpc.simulateTransaction(transaction);
  } catch (error) {
    throw createSimulationError(
      "RPC_ERROR",
      `Failed to call simulateTransaction: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error,
    );
  }

  // Validate simulation success
  const validationError = validateSimulationResult(simResult);
  if (validationError) {
    throw validationError;
  }

  // Parse successful simulation result
  const result = parseSimulationResult(simResult);

  // Cache the result
  if (useCache) {
    cacheSimulation(transactionXdr, result);
  }

  return result;
}

/**
 * Validates that the simulation was successful.
 * Checks for error conditions like IngressExpiration, InvalidAction, etc.
 *
 * @returns SimulationError if validation fails, null if successful
 */
function validateSimulationResult(
  simResult: Api.SimulateTransactionResponse,
): SimulationError | null {
  // Check for error field in response
  if ("error" in simResult && simResult.error) {
    return createSimulationError(
      "SIMULATION_ERROR",
      `Simulation failed: ${simResult.error}`,
      simResult.error,
    );
  }

  // Check for error result (transaction failed)
  if ("errorResult" in simResult && simResult.errorResult) {
    const errorResult = simResult.errorResult as unknown;
    const errorMsg = extractErrorMessage(errorResult);
    return createSimulationError("TRANSACTION_FAILED", errorMsg, errorResult);
  }

  // Check for specific error types in the response
  const asAny = simResult as Record<string, unknown>;

  // IngressExpiration error
  if (asAny.ingressExpiration !== undefined) {
    return createSimulationError(
      "INGRESS_EXPIRATION",
      "Transaction ingress has expired. Please try again.",
      asAny.ingressExpiration,
    );
  }

  // InvalidAction error
  if (asAny.invalidAction !== undefined) {
    return createSimulationError(
      "INVALID_ACTION",
      "The transaction action is invalid. Please check your contract invocation.",
      asAny.invalidAction,
    );
  }

  // Check for missing required fields in success response
  if (!("minResourceFee" in simResult)) {
    return createSimulationError(
      "INVALID_RESPONSE",
      "Simulation response missing minResourceFee. RPC may be misconfigured.",
      simResult,
    );
  }

  return null;
}

/**
 * Parses a successful simulation result to extract fees and resource usage.
 */
function parseSimulationResult(
  simResult: Api.SimulateTransactionResponse,
): SimulationResult {
  const successResult = simResult as Api.SimulateTransactionSuccessResponse;

  // Extract minResourceFee
  const minResourceFee = successResult.minResourceFee ?? "0";

  // Extract cost information (CPU instructions and memory)
  const asAny = simResult as Record<string, unknown>;
  const cost = asAny.cost as { cpuInsns?: string; memBytes?: string } | undefined;
  const cpuInstructions = cost?.cpuInsns ?? "0";
  const memoryBytes = cost?.memBytes ?? "0";

  // Extract transaction data (read/write bytes)
  const transactionData = successResult.transactionData;
  let readBytes = 0;
  let writeBytes = 0;

  if (transactionData) {
    const dataAsAny = transactionData as Record<string, unknown>;
    readBytes = (dataAsAny.readBytes as number) ?? 0;
    writeBytes = (dataAsAny.writeBytes as number) ?? 0;
  }

  return {
    minResourceFee,
    cpuInstructions,
    memoryBytes,
    readBytes,
    writeBytes,
    raw: simResult,
  };
}

/**
 * Extracts a human-readable error message from various error formats.
 */
function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>;

    // Check for common error message fields
    if (typeof obj.message === "string") {
      return obj.message;
    }

    if (typeof obj.error === "string") {
      return obj.error;
    }

    if (typeof obj.detail === "string") {
      return obj.detail;
    }

    // Try to stringify the error
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown error occurred during simulation";
    }
  }

  return "Unknown error occurred during simulation";
}

/**
 * Creates a SimulationError with user-friendly message.
 */
function createSimulationError(
  type: string,
  message: string,
  details?: unknown,
): SimulationError {
  return {
    type,
    message,
    details,
  };
}

// ─── Error Message Mapping ────────────────────────────────────────────────────

/**
 * Converts a simulation error to a user-friendly message.
 */
export function getSimulationErrorMessage(error: SimulationError): string {
  switch (error.type) {
    case "RPC_ERROR":
      return `Network error: ${error.message}. Please check your connection and try again.`;

    case "INGRESS_EXPIRATION":
      return "Transaction expired. Please try again.";

    case "INVALID_ACTION":
      return "Invalid contract action. Please verify your contract invocation parameters.";

    case "TRANSACTION_FAILED":
      return `Transaction simulation failed: ${error.message}`;

    case "INVALID_RESPONSE":
      return "Received invalid response from RPC. Please try again.";

    case "SIMULATION_ERROR":
      return `Simulation error: ${error.message}`;

    default:
      return error.message || "An unknown error occurred during simulation.";
  }
}

// ─── Utility Functions ─────────────────────────────────────────────────────────

/**
 * Clears the simulation cache.
 * Useful for testing or forcing fresh simulations.
 */
export function clearSimulationCache(): void {
  simulationCache.clear();
}

/**
 * Gets the current cache size (for monitoring).
 */
export function getSimulationCacheSize(): number {
  return simulationCache.size;
}

/**
 * Checks if a simulation result is cached and valid.
 */
export function isSimulationCached(transactionXdr: string): boolean {
  return getCachedSimulation(transactionXdr) !== null;
}
