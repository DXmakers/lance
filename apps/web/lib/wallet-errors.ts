/**
 * Wallet Error Handling Utilities
 * 
 * Centralized error handling for Stellar wallet operations
 * Provides consistent error messages and categorization
 */

export enum WalletErrorType {
  USER_REJECTION = 'USER_REJECTION',
  WALLET_NOT_FOUND = 'WALLET_NOT_FOUND',
  WALLET_LOCKED = 'WALLET_LOCKED',
  NETWORK_MISMATCH = 'NETWORK_MISMATCH',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  INVALID_TRANSACTION = 'INVALID_TRANSACTION',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  SIGNING_FAILED = 'SIGNING_FAILED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export interface WalletError {
  type: WalletErrorType;
  message: string;
  originalError?: Error;
  userFriendlyMessage: string;
  recoveryAction?: string;
}

export function categorizeWalletError(error: Error | string | unknown): WalletError {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const originalError = error instanceof Error ? error : new Error(String(error));

  // User rejection errors
  if (errorMessage.includes("User rejected") || 
      errorMessage.includes("rejected") ||
      errorMessage.includes("denied") ||
      errorMessage.includes("cancelled")) {
    return {
      type: WalletErrorType.USER_REJECTION,
      message: errorMessage,
      originalError,
      userFriendlyMessage: "Wallet connection was rejected.",
      recoveryAction: "Please try again and approve the connection in your wallet."
    };
  }

  // Wallet not installed/available
  if (errorMessage.includes("not installed") || 
      errorMessage.includes("not available") ||
      errorMessage.includes("not found")) {
    return {
      type: WalletErrorType.WALLET_NOT_FOUND,
      message: errorMessage,
      originalError,
      userFriendlyMessage: "Wallet extension not found.",
      recoveryAction: "Please install a supported wallet (Freighter, Albedo, or xBull)."
    };
  }

  // Wallet locked
  if (errorMessage.includes("locked")) {
    return {
      type: WalletErrorType.WALLET_LOCKED,
      message: errorMessage,
      originalError,
      userFriendlyMessage: "Wallet is locked.",
      recoveryAction: "Please unlock your wallet and try again."
    };
  }

  // Invalid address
  if (errorMessage.includes("Invalid Stellar account address") ||
      errorMessage.includes("address")) {
    return {
      type: WalletErrorType.INVALID_ADDRESS,
      message: errorMessage,
      originalError,
      userFriendlyMessage: "Invalid wallet address received.",
      recoveryAction: "Please try connecting again or contact support if the issue persists."
    };
  }

  // Invalid transaction
  if (errorMessage.includes("Invalid Stellar transaction") ||
      errorMessage.includes("transaction XDR")) {
    return {
      type: WalletErrorType.INVALID_TRANSACTION,
      message: errorMessage,
      originalError,
      userFriendlyMessage: "Invalid transaction format.",
      recoveryAction: "Please check the transaction details and try again."
    };
  }

  // Connection/Signing failures
  if (errorMessage.includes("connection") || 
      errorMessage.includes("Connection") ||
      errorMessage.includes("signing") ||
      errorMessage.includes("Signing")) {
    const type = errorMessage.includes("signing") || errorMessage.includes("Signing") 
      ? WalletErrorType.SIGNING_FAILED 
      : WalletErrorType.CONNECTION_FAILED;
    
    return {
      type,
      message: errorMessage,
      originalError,
      userFriendlyMessage: type === WalletErrorType.SIGNING_FAILED 
        ? "Transaction signing failed."
        : "Wallet connection failed.",
      recoveryAction: "Please check your wallet connection and try again."
    };
  }

  // Unknown errors
  return {
    type: WalletErrorType.UNKNOWN_ERROR,
    message: errorMessage,
    originalError,
    userFriendlyMessage: "An unexpected error occurred.",
    recoveryAction: "Please try again. If the issue persists, contact support."
  };
}

export function getErrorRecoverySteps(error: WalletError): string[] {
  const steps: string[] = [];

  switch (error.type) {
    case WalletErrorType.USER_REJECTION:
      steps.push("Check your wallet extension popup");
      steps.push("Click 'Approve' or 'Connect' in your wallet");
      steps.push("Try connecting again");
      break;

    case WalletErrorType.WALLET_NOT_FOUND:
      steps.push("Install Freighter, Albedo, or xBull wallet");
      steps.push("Enable the wallet extension in your browser");
      steps.push("Refresh the page and try again");
      break;

    case WalletErrorType.WALLET_LOCKED:
      steps.push("Open your wallet extension");
      steps.push("Enter your password to unlock");
      steps.push("Try connecting again");
      break;

    case WalletErrorType.NETWORK_MISMATCH:
      steps.push("Open your wallet settings");
      steps.push(`Switch network to match the app network`);
      steps.push("Try connecting again");
      break;

    case WalletErrorType.CONNECTION_FAILED:
      steps.push("Check your internet connection");
      steps.push("Ensure wallet extension is enabled");
      steps.push("Try refreshing the page");
      break;

    case WalletErrorType.SIGNING_FAILED:
      steps.push("Check the transaction details");
      steps.push("Ensure you have sufficient balance");
      steps.push("Try signing the transaction again");
      break;

    default:
      steps.push("Refresh the page");
      steps.push("Check your wallet extension");
      steps.push("Try connecting again");
      break;
  }

  return steps;
}

export function formatErrorForDisplay(error: WalletError): {
  title: string;
  description: string;
  recoverySteps: string[];
  severity: 'low' | 'medium' | 'high';
} {
  const recoverySteps = getErrorRecoverySteps(error);
  
  let severity: 'low' | 'medium' | 'high' = 'medium';
  
  switch (error.type) {
    case WalletErrorType.USER_REJECTION:
      severity = 'low';
      break;
    case WalletErrorType.WALLET_NOT_FOUND:
    case WalletErrorType.WALLET_LOCKED:
      severity = 'medium';
      break;
    case WalletErrorType.INVALID_ADDRESS:
    case WalletErrorType.INVALID_TRANSACTION:
      severity = 'high';
      break;
    default:
      severity = 'medium';
  }

  return {
    title: error.userFriendlyMessage,
    description: error.recoveryAction || error.message,
    recoverySteps,
    severity
  };
}
