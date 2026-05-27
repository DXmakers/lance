"use client";

/**
 * TransactionDashboard.tsx
 *
 * Complete transaction interface with progress tracker and block explorer integration.
 * Shows real-time transaction status, technical details, and error handling.
 */

import React, { useState } from "react";
import {
  AlertCircle,
  RefreshCw,
  Phone,
  Zap,
  Wifi,
  WifiOff,
} from "lucide-react";
import { ProgressTracker } from "./ProgressTracker";
import { TxDetailsCard } from "./TxDetailsCard";
import { TransactionEvent, TransactionState } from "@/lib/transactions/lifecycle";

interface TransactionDashboardProps {
  /** Current transaction state */
  state: TransactionState;
  /** Whether transaction is processing */
  isProcessing: boolean;
  /** Current transaction event */
  event: TransactionEvent | null;
  /** Error message (if any) */
  error?: string | null;
  /** Whether RPC is connected */
  isRpcConnected?: boolean;
  /** Callback to retry transaction */
  onRetry?: () => void;
  /** Callback to cancel transaction */
  onCancel?: () => void;
  /** Callback to refresh status */
  onRefresh?: () => void;
  /** Network (testnet or public) */
  network?: "testnet" | "public";
}

/**
 * Determines error suggestions based on error message.
 */
function getErrorSuggestions(error: string): string[] {
  const suggestions: string[] = [];

  if (error.toLowerCase().includes("fee") || error.toLowerCase().includes("insufficient")) {
    suggestions.push("Try increasing the transaction fee");
  }

  if (error.toLowerCase().includes("sequence")) {
    suggestions.push("Refresh your account and try again");
  }

  if (error.toLowerCase().includes("network") || error.toLowerCase().includes("timeout")) {
    suggestions.push("Check your internet connection");
    suggestions.push("Try again in a few moments");
  }

  if (error.toLowerCase().includes("contract")) {
    suggestions.push("Verify the contract parameters");
    suggestions.push("Check the contract state");
  }

  if (suggestions.length === 0) {
    suggestions.push("Contact support if the problem persists");
  }

  return suggestions;
}

/**
 * TransactionDashboard component showing complete transaction interface.
 */
export function TransactionDashboard({
  state,
  isProcessing,
  event,
  error,
  isRpcConnected = true,
  onRetry,
  onCancel,
  onRefresh,
  network = "testnet",
}: TransactionDashboardProps) {
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"retry" | "cancel" | null>(null);

  const isFailed = state === "FAILED";
  const isSuccess = state === "SUCCESS";
  const errorSuggestions = error ? getErrorSuggestions(error) : [];

  /**
   * Handles retry action with confirmation.
   */
  const handleRetry = () => {
    setConfirmAction("retry");
    setShowConfirmation(true);
  };

  /**
   * Handles cancel action with confirmation.
   */
  const handleCancel = () => {
    setConfirmAction("cancel");
    setShowConfirmation(true);
  };

  /**
   * Confirms the action.
   */
  const confirmActionHandler = () => {
    setShowConfirmation(false);

    if (confirmAction === "retry" && onRetry) {
      onRetry();
    } else if (confirmAction === "cancel" && onCancel) {
      onCancel();
    }

    setConfirmAction(null);
  };

  return (
    <div className="space-y-6">
      {/* RPC Connection Status */}
      <div
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm ${
          isRpcConnected
            ? "bg-green-50 text-green-700 border border-green-200"
            : "bg-yellow-50 text-yellow-700 border border-yellow-200"
        }`}
      >
        {isRpcConnected ? (
          <>
            <Wifi className="h-4 w-4" />
            <span>Connected to Soroban RPC</span>
          </>
        ) : (
          <>
            <WifiOff className="h-4 w-4" />
            <span>Using Horizon fallback</span>
          </>
        )}
      </div>

      {/* Progress Tracker */}
      <ProgressTracker
        state={state}
        isProcessing={isProcessing}
        error={error}
      />

      {/* Error Display with Suggestions */}
      {isFailed && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-red-900">Transaction Failed</h3>
              <p className="text-sm text-red-800 mt-1">{error}</p>
            </div>
          </div>

          {/* Error Suggestions */}
          {errorSuggestions.length > 0 && (
            <div className="ml-8 space-y-2">
              <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">
                Suggestions:
              </p>
              <ul className="space-y-1">
                {errorSuggestions.map((suggestion, idx) => (
                  <li key={idx} className="text-sm text-red-700 flex items-start gap-2">
                    <span className="text-red-500 mt-1">•</span>
                    <span>{suggestion}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 mt-4 ml-8">
            {onRetry && (
              <button
                onClick={handleRetry}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </button>
            )}

            {onCancel && (
              <button
                onClick={handleCancel}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-red-300 text-red-700 text-sm font-medium hover:bg-red-50 transition-colors"
              >
                Cancel
              </button>
            )}

            <a
              href="https://discord.gg/stellar"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              <Phone className="h-4 w-4" />
              Contact Support
            </a>
          </div>
        </div>
      )}

      {/* Technical Details Card */}
      {event && (state === "SUCCESS" || state === "FAILED" || event.devData) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">
              Technical Details
            </h3>
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-600 hover:bg-slate-100 transition-colors"
                title="Refresh transaction status"
              >
                <RefreshCw className="h-3 w-3" />
                Refresh
              </button>
            )}
          </div>

          <TxDetailsCard event={event} network={network} />
        </div>
      )}

      {/* Simulation Details */}
      {event?.simulation && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">
            Simulation Results
          </h3>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-slate-500 text-xs">CPU Instructions</span>
              <p className="font-mono text-slate-800 mt-1">
                {event.simulation.cpuInstructions || "N/A"}
              </p>
            </div>

            <div>
              <span className="text-slate-500 text-xs">Memory Bytes</span>
              <p className="font-mono text-slate-800 mt-1">
                {event.simulation.memoryBytes || "N/A"}
              </p>
            </div>

            <div>
              <span className="text-slate-500 text-xs">Read Bytes</span>
              <p className="font-mono text-slate-800 mt-1">
                {event.simulation.readBytes || "N/A"}
              </p>
            </div>

            <div>
              <span className="text-slate-500 text-xs">Write Bytes</span>
              <p className="font-mono text-slate-800 mt-1">
                {event.simulation.writeBytes || "N/A"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Fee Estimate */}
      {event?.feeEstimate && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-amber-900">Fee Estimate</h3>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-amber-700">Base Fee:</span>
              <code className="font-mono text-amber-900">
                {event.feeEstimate.baseResourceFee} stroops
              </code>
            </div>

            <div className="flex justify-between">
              <span className="text-amber-700">Resource Fee:</span>
              <code className="font-mono text-amber-900">
                {event.feeEstimate.baseResourceFee} stroops
              </code>
            </div>

            <div className="flex justify-between font-semibold border-t border-amber-200 pt-2">
              <span className="text-amber-900">Total:</span>
              <code className="font-mono text-amber-900">
                {event.feeEstimate.totalFee} stroops
              </code>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-sm w-full p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">
              {confirmAction === "retry"
                ? "Retry Transaction?"
                : "Cancel Transaction?"}
            </h2>

            <p className="text-sm text-slate-600">
              {confirmAction === "retry"
                ? "This will attempt to resubmit the transaction. Are you sure?"
                : "This will cancel the current transaction. Are you sure?"}
            </p>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirmation(false)}
                className="px-4 py-2 rounded-md border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                No, Keep It
              </button>

              <button
                onClick={confirmActionHandler}
                className={`px-4 py-2 rounded-md text-white text-sm font-medium transition-colors ${
                  confirmAction === "retry"
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {confirmAction === "retry" ? "Yes, Retry" : "Yes, Cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
