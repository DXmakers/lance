/**
 * provider.ts
 *
 * Secure wallet provider integration supporting multiple wallet types.
 * Supports Freighter, WalletConnect, Albedo, and Rabet.
 * Never accesses private keys directly - always delegates to wallet provider.
 */

import { Transaction, xdr } from "@stellar/stellar-sdk";

export type WalletProviderType = "freighter" | "walletconnect" | "albedo" | "rabet";

export interface WalletProvider {
  /** Unique identifier for the wallet provider */
  id: WalletProviderType;
  /** Display name for the wallet */
  name: string;
  /** Whether the provider is currently available */
  isAvailable: boolean;
  /** Sign a transaction using the wallet */
  signTransaction(tx: Transaction): Promise<string>;
  /** Sign an auth entry for multi-party operations */
  signAuthEntry(authEntry: xdr.SorobanAuthorizationEntry): Promise<xdr.SorobanAuthorizationEntry>;
  /** Get the connected account address */
  getAddress(): Promise<string>;
  /** Disconnect the wallet */
  disconnect(): Promise<void>;
}

export interface SigningRequest {
  /** Transaction to sign */
  transaction: Transaction;
  /** Source account address */
  sourceAddress: string;
  /** Optional description of what the transaction does */
  description?: string;
  /** Whether this is a multi-party operation requiring authorization */
  requiresAuthorization?: boolean;
}

export interface SigningResult {
  /** Signed transaction XDR */
  signedXdr: string;
  /** Transaction hash for verification */
  txHash: string;
  /** Wallet provider that signed the transaction */
  provider: WalletProviderType;
  /** Timestamp of signing */
  signedAt: Date;
}

export interface SigningError {
  code: "REJECTED" | "INVALID_TRANSACTION" | "NETWORK_ERROR" | "UNKNOWN";
  message: string;
  provider: WalletProviderType;
}

/**
 * Sanitizes XDR strings for logging by removing sensitive data.
 * Returns a truncated hash representation instead of full XDR.
 *
 * @param xdr - The XDR string to sanitize
 * @returns Sanitized representation safe for logging
 */
export function sanitizeXdrForLogging(xdr: string): string {
  if (!xdr) return "[empty]";
  if (xdr.length < 20) return "[short]";
  // Return first 8 and last 8 characters with hash indicator
  const start = xdr.substring(0, 8);
  const end = xdr.substring(xdr.length - 8);
  return `${start}...${end} (length: ${xdr.length})`;
}

/**
 * Computes transaction hash for manual verification.
 * Uses the transaction's envelope hash.
 *
 * @param tx - The transaction to hash
 * @returns Hex-encoded transaction hash
 */
export function getTransactionHash(tx: Transaction): string {
  try {
    const envelope = tx.toEnvelope();
    const hash = envelope.hash();
    return hash.toString("hex");
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("[provider] Failed to compute transaction hash:", error);
    }
    return "";
  }
}

/**
 * Validates transaction before sending to wallet for signing.
 * Checks sequence number and basic transaction structure.
 *
 * @param tx - The transaction to validate
 * @param sourceAddress - Expected source account address
 * @returns Validation result with any errors
 */
export function validateTransactionBeforeSigning(
  tx: Transaction,
  sourceAddress: string,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check transaction exists
  if (!tx) {
    errors.push("Transaction is missing");
    return { valid: false, errors };
  }

  // Check source account
  if (!tx.source || tx.source !== sourceAddress) {
    errors.push(
      `Transaction source account mismatch. Expected: ${sourceAddress}, Got: ${tx.source}`,
    );
  }

  // Check sequence number is valid
  if (!tx.sequence || tx.sequence === "0") {
    errors.push("Transaction has invalid sequence number");
  }

  // Check operations exist
  if (!tx.operations || tx.operations.length === 0) {
    errors.push("Transaction has no operations");
  }

  // Check fee is set
  if (!tx.fee || parseInt(tx.fee) <= 0) {
    errors.push("Transaction has invalid fee");
  }

  // Check timebounds
  if (!tx.timebounds) {
    errors.push("Transaction has no timebounds");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Formats transaction details for user display before signing.
 * Provides human-readable information about what the transaction does.
 *
 * @param tx - The transaction to format
 * @returns Formatted transaction details
 */
export function formatTransactionForDisplay(tx: Transaction): {
  operationCount: number;
  fee: string;
  source: string;
  operations: string[];
} {
  const operations = tx.operations.map((op) => {
    const type = (op as { type?: string }).type || "Unknown";
    return type;
  });

  return {
    operationCount: tx.operations.length,
    fee: tx.fee,
    source: tx.source,
    operations,
  };
}

/**
 * Detects if a signing error is due to user rejection.
 *
 * @param error - The error to check
 * @returns true if the error indicates user rejection
 */
export function isSigningRejected(error: unknown): boolean {
  if (!error) return false;

  const errorStr = String(error).toLowerCase();
  return (
    errorStr.includes("reject") ||
    errorStr.includes("cancel") ||
    errorStr.includes("denied") ||
    errorStr.includes("user") ||
    errorStr.includes("abort")
  );
}

/**
 * Creates a user-friendly error message for signing failures.
 *
 * @param error - The error that occurred
 * @param provider - The wallet provider
 * @returns User-friendly error message
 */
export function getSigningErrorMessage(
  error: unknown,
  provider: WalletProviderType,
): string {
  if (isSigningRejected(error)) {
    return "You rejected the transaction signing request. No transaction was submitted.";
  }

  const errorMsg = error instanceof Error ? error.message : String(error);

  if (errorMsg.includes("network")) {
    return `Network error with ${provider} wallet. Please check your connection and try again.`;
  }

  if (errorMsg.includes("sequence")) {
    return "Transaction sequence number is invalid. Please refresh and try again.";
  }

  if (errorMsg.includes("balance")) {
    return "Insufficient balance to pay transaction fees.";
  }

  return `Failed to sign transaction with ${provider} wallet: ${errorMsg}`;
}

/**
 * Extracts the signed transaction XDR from wallet response.
 * Handles different response formats from various wallet providers.
 *
 * @param response - The response from wallet signing
 * @returns Signed transaction XDR
 */
export function extractSignedXdr(response: unknown): string {
  if (typeof response === "string") {
    return response;
  }

  if (typeof response === "object" && response !== null) {
    const obj = response as Record<string, unknown>;
    // Try common response field names
    if (typeof obj.signedTxXdr === "string") return obj.signedTxXdr;
    if (typeof obj.signedXDR === "string") return obj.signedXDR;
    if (typeof obj.signedXdr === "string") return obj.signedXdr;
    if (typeof obj.xdr === "string") return obj.xdr;
  }

  throw new Error("Unable to extract signed XDR from wallet response");
}

/**
 * Validates that a signed XDR is properly formatted.
 *
 * @param signedXdr - The signed XDR to validate
 * @returns true if valid, false otherwise
 */
export function isValidSignedXdr(signedXdr: string): boolean {
  if (!signedXdr || typeof signedXdr !== "string") {
    return false;
  }

  // XDR strings are base64-encoded and typically start with "AAAA"
  return signedXdr.length > 100 && /^[A-Za-z0-9+/=]+$/.test(signedXdr);
}
