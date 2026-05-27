/**
 * index.ts
 *
 * Main export file for secure wallet integration.
 * Provides convenient access to wallet provider and transaction signing functionality.
 */

export {
  sanitizeXdrForLogging,
  getTransactionHash,
  validateTransactionBeforeSigning,
  formatTransactionForDisplay,
  isSigningRejected,
  getSigningErrorMessage,
  extractSignedXdr,
  isValidSignedXdr,
} from "./provider";

export type {
  WalletProvider,
  WalletProviderType,
  SigningRequest,
  SigningResult,
  SigningError,
} from "./provider";

export {
  signTransaction,
  signAuthorizationEntry,
  getVerificationHash,
  formatHashForDisplay,
  cancelSigning,
  getActiveSessions,
  clearExpiredSessions,
  getSigningSession,
} from "./signer";

export type {
  SigningOptions,
  SigningSession,
} from "./signer";
