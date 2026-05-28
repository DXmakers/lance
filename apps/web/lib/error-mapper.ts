export interface ErrorToast {
  title: string;
  description: string;
}

interface StellarError {
  response?: {
    data?: {
      extras?: {
        result_codes?: {
          transaction?: string | string[];
          operations?: string[];
        };
      };
    };
    status?: number;
    statusText?: string;
  };
  message?: string;
}

const STELLAR_ERROR_MAP: Record<string, ErrorToast> = {
  tx_bad_seq: {
    title: "Transaction Sequence Error",
    description: "Your wallet is out of sync. Please refresh the page and try again.",
  },
  tx_insufficient_balance: {
    title: "Insufficient Funds",
    description: "Your wallet doesn't have enough XLM to complete this transaction.",
  },
  tx_bad_auth: {
    title: "Authentication Failed",
    description: "Transaction signature is invalid. Please check your wallet connection.",
  },
  tx_bad_auth_extra: {
    title: "Extra Authentication Required",
    description: "Additional signatures are needed for this transaction.",
  },
  tx_fee_bump_inner_failed: {
    title: "Fee Bump Failed",
    description: "The inner transaction failed during fee bump processing.",
  },
  tx_insufficient_fee: {
    title: "Fee Too Low",
    description: "The transaction fee offered is below the network minimum.",
  },
  tx_no_source_account: {
    title: "Source Account Not Found",
    description: "The source account does not exist on the Stellar network.",
  },
  tx_too_early: {
    title: "Transaction Too Early",
    description: "The transaction time bounds have not yet been reached.",
  },
  tx_too_late: {
    title: "Transaction Expired",
    description: "The transaction time bounds have already passed.",
  },
  tx_missing_operation: {
    title: "Missing Operation",
    description: "No operations were included in this transaction.",
  },
  tx_bad_min_seq_age_or_gap: {
    title: "Invalid Sequence Requirements",
    description: "The minimum sequence age or gap conditions were not met.",
  },
  tx_malformed: {
    title: "Malformed Transaction",
    description: "The transaction format is invalid. Please try again.",
  },
  op_underfunded: {
    title: "Insufficient Escrow Funds",
    description: "The escrow account doesn't have enough funds for this operation.",
  },
  op_over_source_max: {
    title: "Exceeds Maximum Amount",
    description: "The operation amount exceeds the specified maximum.",
  },
  op_line_full: {
    title: "Trust Line Full",
    description: "The destination trust line has reached its limit.",
  },
  op_no_trust: {
    title: "No Trust Line",
    description: "The destination account doesn't trust this asset.",
  },
  op_not_authorized: {
    title: "Not Authorized",
    description: "You don't have permission to perform this operation.",
  },
  op_low_reserve: {
    title: "Low Reserve",
    description: "This operation would drop the account below the minimum reserve.",
  },
  op_cross_self: {
    title: "Self Trade",
    description: "This operation would result in a trade with yourself.",
  },
  op_over_dest_max: {
    title: "Exceeds Destination Maximum",
    description: "The operation would exceed the destination maximum.",
  },
  op_buy_no_trust: {
    title: "No Trust Line for Buying",
    description: "The buying account doesn't have a trust line for this asset.",
  },
  op_sell_no_trust: {
    title: "No Trust Line for Selling",
    description: "The selling account doesn't have a trust line for this asset.",
  },
  op_buy_not_authorized: {
    title: "Not Authorized to Buy",
    description: "The buying account is not authorized to hold this asset.",
  },
  op_sell_not_authorized: {
    title: "Not Authorized to Sell",
    description: "The selling account is not authorized to hold this asset.",
  },
  op_sponsor_not_sponsored: {
    title: "Not Sponsored",
    description: "The entry is not sponsored by any account.",
  },

  // ── Job Registry contract errors ─────────────────────────────────────────
  "AlreadyInitialized": {
    title: "Contract Already Initialized",
    description: "The job registry contract has already been initialized.",
  },
  "NotInitialized": {
    title: "Contract Not Initialized",
    description: "The job registry contract has not been initialized. Contact the admin.",
  },
  "InvalidJobId": {
    title: "Invalid Job ID",
    description: "The provided job ID is invalid. Job IDs must be positive integers.",
  },
  "InvalidBudget": {
    title: "Invalid Budget",
    description: "The budget must be greater than zero.",
  },
  "InvalidHash": {
    title: "Invalid Metadata Hash",
    description: "The metadata hash is empty or exceeds the maximum allowed length.",
  },
  "JobAlreadyExists": {
    title: "Job Already Exists",
    description: "A job with this ID already exists on-chain. Try again with a different ID.",
  },
  "JobNotFound": {
    title: "Job Not Found",
    description: "The specified job does not exist on-chain.",
  },
  "JobNotOpen": {
    title: "Job Not Open",
    description: "This job is no longer accepting bids.",
  },
  "Unauthorized": {
    title: "Unauthorized",
    description: "You are not authorized to perform this action on this job.",
  },
  "BidAlreadySubmitted": {
    title: "Bid Already Submitted",
    description: "You have already submitted a bid for this job.",
  },
  "BidNotFound": {
    title: "Bid Not Found",
    description: "The specified bid could not be found for this job.",
  },
  "InvalidStateTransition": {
    title: "Invalid State Transition",
    description: "This action is not allowed in the current job state.",
  },
  "NoDeliverable": {
    title: "No Deliverable",
    description: "No deliverable has been submitted for this job.",
  },
  "Overflow": {
    title: "Arithmetic Overflow",
    description: "An arithmetic overflow occurred. The values may be too large.",
  },

  // ── Simulation / pipeline errors ─────────────────────────────────────────
  "Simulation failed": {
    title: "Simulation Failed",
    description: "The transaction simulation failed. Check the contract parameters and try again.",
  },
  "Confirmation timed out": {
    title: "Confirmation Timeout",
    description: "The transaction was submitted but not confirmed in time. Check the explorer for status.",
  },
  "Transaction submission failed": {
    title: "Submission Failed",
    description: "The transaction was rejected by the network. Please try again.",
  },
  "Transaction failed on-chain": {
    title: "On-Chain Failure",
    description: "The transaction was included but execution failed on-chain.",
  },
};

const BACKEND_ERROR_MAP: Record<string, ErrorToast> = {
  "401": {
    title: "Not Authorized",
    description: "You don't have permission to perform this action.",
  },
  "403": {
    title: "Access Denied",
    description: "You don't have access to this resource.",
  },
  "404": {
    title: "Not Found",
    description: "The requested resource could not be found.",
  },
  "409": {
    title: "Conflict",
    description: "This action conflicts with the current state. Please refresh and try again.",
  },
  "422": {
    title: "Validation Error",
    description: "The provided data is invalid. Please check your inputs and try again.",
  },
  "429": {
    title: "Rate Limited",
    description: "Too many requests. Please wait a moment before trying again.",
  },
  "500": {
    title: "Server Error",
    description: "Something went wrong on our end. Please try again later.",
  },
  "502": {
    title: "Service Unavailable",
    description: "The service is temporarily unavailable. Please try again later.",
  },
  "503": {
    title: "Service Overloaded",
    description: "The service is currently overloaded. Please try again in a moment.",
  },
};

const WALLET_ERROR_MAP: Record<string, ErrorToast> = {
  "User declined access": {
    title: "Wallet Connection Declined",
    description: "You declined the wallet connection request. Please try again.",
  },
  "User rejected the request": {
    title: "Transaction Rejected",
    description: "You rejected the transaction in your wallet.",
  },
  "Wallet not connected": {
    title: "Wallet Not Connected",
    description: "Please connect your wallet first before performing this action.",
  },
  "Freighter is not installed": {
    title: "Freighter Not Found",
    description: "Please install the Freighter wallet extension to continue.",
  },
  "Network mismatch": {
    title: "Network Mismatch",
    description: "Your wallet is on a different network. Please switch to the correct network.",
  },
};

export function mapErrorToToast(error: unknown): ErrorToast {
  if (error instanceof Error) {
    const message = error.message;

    for (const [key, value] of Object.entries(WALLET_ERROR_MAP)) {
      if (message.includes(key)) {
        return value;
      }
    }

    for (const [key, value] of Object.entries(STELLAR_ERROR_MAP)) {
      if (message.includes(key)) {
        return value;
      }
    }

    const stellarError = error as StellarError;
    if (stellarError.response?.data?.extras?.result_codes) {
      const resultCodes = stellarError.response.data.extras.result_codes;

      if (typeof resultCodes.transaction === "string") {
        const mapped = STELLAR_ERROR_MAP[resultCodes.transaction];
        if (mapped) return mapped;
      }

      if (Array.isArray(resultCodes.transaction)) {
        for (const code of resultCodes.transaction) {
          const mapped = STELLAR_ERROR_MAP[code];
          if (mapped) return mapped;
        }
      }

      if (resultCodes.operations) {
        for (const opCode of resultCodes.operations) {
          const mapped = STELLAR_ERROR_MAP[opCode];
          if (mapped) return mapped;
        }
      }
    }

    if (stellarError.response?.status) {
      const statusCode = String(stellarError.response.status);
      const mapped = BACKEND_ERROR_MAP[statusCode];
      if (mapped) return mapped;
    }

    return {
      title: "Transaction Failed",
      description: message || "An unexpected error occurred. Please try again.",
    };
  }

  if (typeof error === "string") {
    for (const [key, value] of Object.entries(STELLAR_ERROR_MAP)) {
      if (error.includes(key)) {
        return value;
      }
    }

    return {
      title: "Error",
      description: error,
    };
  }

  return {
    title: "Unknown Error",
    description: "An unexpected error occurred. Please try again.",
  };
}

export function mapBackendError(statusCode: number, message?: string): ErrorToast {
  const mapped = BACKEND_ERROR_MAP[String(statusCode)];
  if (mapped) return mapped;

  return {
    title: "Request Failed",
    description: message || `Request failed with status ${statusCode}`,
  };
}

/**
 * Detect insufficient-balance errors across every layer the wallet/SDK can
 * surface them (Horizon transaction codes, Soroban operation codes, raw
 * simulation strings, generic "underfunded" messages). Used by the UI to
 * branch into the dedicated `InsufficientBalanceAlert` recovery view (#179).
 */
const INSUFFICIENT_BALANCE_MARKERS = [
  "tx_insufficient_balance",
  "op_underfunded",
  "insufficient balance",
  "insufficient funds",
  "underfunded",
  "balance below",
] as const;

export function isInsufficientBalanceError(error: unknown): boolean {
  const haystack = collectErrorStrings(error).map((s) => s.toLowerCase());
  return haystack.some((s) =>
    INSUFFICIENT_BALANCE_MARKERS.some((marker) => s.includes(marker.toLowerCase())),
  );
}

function collectErrorStrings(error: unknown): string[] {
  const out: string[] = [];
  if (typeof error === "string") {
    out.push(error);
    return out;
  }
  if (error instanceof Error) {
    out.push(error.message);
  }
  const stellarError = error as StellarError;
  const codes = stellarError.response?.data?.extras?.result_codes;
  if (codes) {
    if (typeof codes.transaction === "string") {
      out.push(codes.transaction);
    } else if (Array.isArray(codes.transaction)) {
      out.push(...codes.transaction);
    }
    if (codes.operations) {
      out.push(...codes.operations);
    }
  }
  return out;
}
