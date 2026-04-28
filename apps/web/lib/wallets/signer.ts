/**
 * signer.ts
 *
 * Secure transaction signing orchestration.
 * Handles pre-validation, wallet selection, signing requests, and error handling.
 * Never exposes private keys - always delegates to wallet provider.
 */

import { Transaction, xdr } from "@stellar/stellar-sdk";
import {
  WalletProviderType,
  SigningRequest,
  SigningResult,
  SigningError,
  sanitizeXdrForLogging,
  getTransactionHash,
  validateTransactionBeforeSigning,
  formatTransactionForDisplay,
  isSigningRejected,
  getSigningErrorMessage,
  extractSignedXdr,
  isValidSignedXdr,
} from "./provider";
import { getWalletsKit } from "../stellar";

export interface SigningOptions {
  /** Wallet provider to use (if not specified, uses connected wallet) */
  provider?: WalletProviderType;
  /** Whether to show transaction details before signing */
  showDetails?: boolean;
  /** Custom timeout for signing request in milliseconds */
  timeoutMs?: number;
  /** Whether to require user confirmation before signing */
  requireConfirmation?: boolean;
}

export interface SigningSession {
  /** Unique session ID for tracking */
  sessionId: string;
  /** Transaction being signed */
  transaction: Transaction;
  /** Source account address */
  sourceAddress: string;
  /** Wallet provider being used */
  provider: WalletProviderType;
  /** Transaction hash for verification */
  txHash: string;
  /** Timestamp of session creation */
  createdAt: Date;
  /** Whether signing is in progress */
  isSigningInProgress: boolean;
}

// Session tracking for debugging and audit trails
const activeSessions = new Map<string, SigningSession>();

/**
 * Generates a unique session ID for tracking signing operations.
 *
 * @returns Unique session ID
 */
function generateSessionId(): string {
  return `sig_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

/**
 * Creates a new signing session for tracking and audit purposes.
 *
 * @param tx - The transaction to sign
 * @param sourceAddress - Source account address
 * @param provider - Wallet provider
 * @returns Signing session
 */
function createSigningSession(
  tx: Transaction,
  sourceAddress: string,
  provider: WalletProviderType,
): SigningSession {
  const sessionId = generateSessionId();
  const txHash = getTransactionHash(tx);

  const session: SigningSession = {
    sessionId,
    transaction: tx,
    sourceAddress,
    provider,
    txHash,
    createdAt: new Date(),
    isSigningInProgress: false,
  };

  activeSessions.set(sessionId, session);

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[signer] Created signing session ${sessionId} for ${provider} wallet`,
    );
  }

  return session;
}

/**
 * Retrieves an active signing session.
 *
 * @param sessionId - Session ID to retrieve
 * @returns Signing session or undefined if not found
 */
export function getSigningSession(sessionId: string): SigningSession | undefined {
  return activeSessions.get(sessionId);
}

/**
 * Cleans up a signing session after completion.
 *
 * @param sessionId - Session ID to clean up
 */
function cleanupSigningSession(sessionId: string): void {
  activeSessions.delete(sessionId);

  if (process.env.NODE_ENV === "development") {
    console.log(`[signer] Cleaned up signing session ${sessionId}`);
  }
}

/**
 * Signs a transaction using the connected wallet.
 * Performs pre-validation, displays transaction details, and handles signing.
 *
 * Flow:
 * 1. Validate transaction before sending to wallet
 * 2. Create signing session for tracking
 * 3. Request user signature via wallet provider
 * 4. Validate signed XDR response
 * 5. Return signed transaction with metadata
 *
 * @param request - Signing request with transaction and options
 * @param options - Additional signing options
 * @returns SigningResult with signed XDR and metadata
 * @throws SigningError on failure
 */
export async function signTransaction(
  request: SigningRequest,
  options: SigningOptions = {},
): Promise<SigningResult> {
  const { transaction, sourceAddress, description } = request;
  const { provider = "freighter", showDetails = true, requireConfirmation = true } = options;

  // Step 1: Pre-validate transaction
  const validation = validateTransactionBeforeSigning(transaction, sourceAddress);
  if (!validation.valid) {
    const errorMsg = validation.errors.join("; ");
    if (process.env.NODE_ENV === "development") {
      console.error("[signer] Transaction validation failed:", errorMsg);
    }

    throw {
      code: "INVALID_TRANSACTION",
      message: `Transaction validation failed: ${errorMsg}`,
      provider,
    } as SigningError;
  }

  // Step 2: Create signing session
  const session = createSigningSession(transaction, sourceAddress, provider);

  try {
    // Step 3: Display transaction details if requested
    if (showDetails) {
      const details = formatTransactionForDisplay(transaction);
      if (process.env.NODE_ENV === "development") {
        console.log("[signer] Transaction details:", {
          sessionId: session.sessionId,
          operations: details.operationCount,
          fee: details.fee,
          txHash: session.txHash,
          description,
        });
      }
    }

    // Step 4: Request user confirmation if required
    if (requireConfirmation) {
      // In a real implementation, this would show a UI confirmation dialog
      // For now, we proceed directly to wallet signing
      if (process.env.NODE_ENV === "development") {
        console.log(
          `[signer] Requesting user confirmation for transaction ${session.txHash}`,
        );
      }
    }

    // Step 5: Request signature from wallet
    session.isSigningInProgress = true;

    if (process.env.NODE_ENV === "development") {
      console.log(
        `[signer] Requesting signature from ${provider} wallet for transaction ${sanitizeXdrForLogging(transaction.toXDR())}`,
      );
    }

    let signedXdr: string;

    try {
      const walletKit = getWalletsKit();
      const txXdr = transaction.toXDR();
      signedXdr = await walletKit.signTransaction(txXdr);
    } catch (error) {
      session.isSigningInProgress = false;

      if (isSigningRejected(error)) {
        if (process.env.NODE_ENV === "development") {
          console.log(`[signer] User rejected signing request for session ${session.sessionId}`);
        }

        throw {
          code: "REJECTED",
          message: getSigningErrorMessage(error, provider),
          provider,
        } as SigningError;
      }

      if (process.env.NODE_ENV === "development") {
        console.error(
          `[signer] Wallet signing error for session ${session.sessionId}:`,
          error,
        );
      }

      throw {
        code: "NETWORK_ERROR",
        message: getSigningErrorMessage(error, provider),
        provider,
      } as SigningError;
    }

    // Step 6: Validate signed XDR
    if (!isValidSignedXdr(signedXdr)) {
      session.isSigningInProgress = false;

      if (process.env.NODE_ENV === "development") {
        console.error(
          `[signer] Invalid signed XDR received for session ${session.sessionId}`,
        );
      }

      throw {
        code: "UNKNOWN",
        message: "Wallet returned invalid signed transaction",
        provider,
      } as SigningError;
    }

    session.isSigningInProgress = false;

    if (process.env.NODE_ENV === "development") {
      console.log(
        `[signer] Successfully signed transaction for session ${session.sessionId}. Signed XDR: ${sanitizeXdrForLogging(signedXdr)}`,
      );
    }

    // Step 7: Return signing result
    const result: SigningResult = {
      signedXdr,
      txHash: session.txHash,
      provider,
      signedAt: new Date(),
    };

    return result;
  } finally {
    // Cleanup session
    cleanupSigningSession(session.sessionId);
  }
}

/**
 * Signs an authorization entry for multi-party operations (e.g., escrow release).
 * Used when multiple parties need to authorize a transaction.
 *
 * @param authEntry - The authorization entry to sign
 * @param sourceAddress - Source account address
 * @param options - Signing options
 * @returns Signed authorization entry
 * @throws SigningError on failure
 */
export async function signAuthorizationEntry(
  authEntry: xdr.SorobanAuthorizationEntry,
  sourceAddress: string,
  options: SigningOptions = {},
): Promise<xdr.SorobanAuthorizationEntry> {
  const { provider = "freighter" } = options;

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[signer] Requesting authorization signature from ${provider} wallet for address ${sourceAddress}`,
    );
  }

  try {
    const walletKit = getWalletsKit();

    // Convert auth entry to XDR for signing
    const authXdr = authEntry.toXDR("base64");

    // Request signature
    const signedXdr = await walletKit.signTransaction(authXdr);

    // Parse signed XDR back to auth entry
    const signedAuthEntry = xdr.SorobanAuthorizationEntry.fromXDR(
      signedXdr,
      "base64",
    );

    if (process.env.NODE_ENV === "development") {
      console.log(
        `[signer] Successfully signed authorization entry from ${provider} wallet`,
      );
    }

    return signedAuthEntry;
  } catch (error) {
    if (isSigningRejected(error)) {
      throw {
        code: "REJECTED",
        message: "You rejected the authorization request.",
        provider,
      } as SigningError;
    }

    if (process.env.NODE_ENV === "development") {
      console.error(`[signer] Authorization signing error:`, error);
    }

    throw {
      code: "NETWORK_ERROR",
      message: getSigningErrorMessage(error, provider),
      provider,
    } as SigningError;
  }
}

/**
 * Gets the transaction hash for manual verification.
 * Returns a copyable hash that users can verify against their wallet.
 *
 * @param tx - The transaction to hash
 * @returns Copyable transaction hash
 */
export function getVerificationHash(tx: Transaction): string {
  return getTransactionHash(tx);
}

/**
 * Formats a transaction hash for display (uppercase hex).
 *
 * @param hash - The transaction hash
 * @returns Formatted hash for display
 */
export function formatHashForDisplay(hash: string): string {
  return hash.toUpperCase();
}

/**
 * Cancels an in-progress signing operation.
 * Used when user wants to abort signing.
 *
 * @param sessionId - Session ID to cancel
 * @returns true if session was cancelled, false if not found
 */
export function cancelSigning(sessionId: string): boolean {
  const session = activeSessions.get(sessionId);

  if (!session) {
    return false;
  }

  if (process.env.NODE_ENV === "development") {
    console.log(`[signer] Cancelled signing session ${sessionId}`);
  }

  cleanupSigningSession(sessionId);
  return true;
}

/**
 * Gets all active signing sessions (for debugging/monitoring).
 *
 * @returns Array of active signing sessions
 */
export function getActiveSessions(): SigningSession[] {
  return Array.from(activeSessions.values());
}

/**
 * Clears all expired signing sessions (older than 1 hour).
 */
export function clearExpiredSessions(): void {
  const now = Date.now();
  const oneHourMs = 60 * 60 * 1000;

  for (const [sessionId, session] of activeSessions.entries()) {
    if (now - session.createdAt.getTime() > oneHourMs) {
      activeSessions.delete(sessionId);

      if (process.env.NODE_ENV === "development") {
        console.log(`[signer] Cleared expired signing session ${sessionId}`);
      }
    }
  }
}
