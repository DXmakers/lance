"use client";

import { useTransactionToast } from "@/hooks/use-transaction-toast";
import { toast } from "@/lib/toast";

export function TransactionExample() {
  const { executeTransaction, showLoading, updateToSuccess, updateToError } =
    useTransactionToast();

  const handleSimpleToast = () => {
    toast.info({
      title: "Information",
      description: "This is a simple info toast",
    });
  };

  const handleSuccessToast = () => {
    toast.success({
      title: "Success!",
      description: "Your action was completed successfully",
      txHash: "a1b2c3d4e5f6g7h8i9j0",
    });
  };

  const handleErrorToast = () => {
    toast.error({
      title: "Error Occurred",
      description: "Something went wrong with your request",
    });
  };

  const handleWarningToast = () => {
    toast.warning({
      title: "Warning",
      description: "Please review your inputs before proceeding",
    });
  };

  const handleSimulatedTransaction = async () => {
    await executeTransaction(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return { txHash: "simulated_tx_hash_12345" };
      },
      {
        loadingMessage: "Creating escrow deposit...",
        successMessage: "Escrow deposit confirmed!",
        errorMessage: "Failed to create escrow deposit",
      },
      {
        onSuccess: (txHash) => {
          console.log("Transaction succeeded:", txHash);
        },
        onError: (error) => {
          console.error("Transaction failed:", error);
        },
      }
    );
  };

  const handleSimulatedError = async () => {
    await executeTransaction(
      async () => {
        await new Promise((_, reject) =>
          setTimeout(() => reject(new Error("tx_insufficient_balance")), 2000)
        );
        return { txHash: "" };
      },
      {
        loadingMessage: "Processing payment...",
        successMessage: "Payment completed!",
        errorMessage: "Payment failed",
      }
    );
  };

  const handleManualFlow = async () => {
    const loadingToast = showLoading(
      "Submitting job...",
      "Please wait while we process your job posting"
    );

    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      updateToSuccess(
        loadingToast,
        "Job Posted!",
        "Your job has been successfully posted to the marketplace",
        "job_tx_abc123"
      );
    } catch {
      updateToError(
        loadingToast,
        "Failed to Post Job",
        "There was an error posting your job. Please try again."
      );
    }
  };

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-bold">Toast Notification Examples</h2>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleSimpleToast}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Info Toast
        </button>

        <button
          onClick={handleSuccessToast}
          className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
        >
          Success + Tx Hash
        </button>

        <button
          onClick={handleErrorToast}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          Error Toast
        </button>

        <button
          onClick={handleWarningToast}
          className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600"
        >
          Warning Toast
        </button>
      </div>

      <h3 className="text-lg font-semibold mt-6">Transaction Flows</h3>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleSimulatedTransaction}
          className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
        >
          Simulate Escrow Deposit (Success)
        </button>

        <button
          onClick={handleSimulatedError}
          className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
        >
          Simulate Transaction (Error)
        </button>

        <button
          onClick={handleManualFlow}
          className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600"
        >
          Manual Toast Flow
        </button>
      </div>

      <div className="mt-6 p-4 bg-gray-100 rounded text-sm">
        <p className="font-semibold">Features demonstrated:</p>
        <ul className="list-disc ml-5 mt-2 space-y-1">
          <li>Five toast types: info, success, error, warning, loading</li>
          <li>Automatic transaction hash linking to Stellar Explorer</li>
          <li>Error code mapping from Stellar SDK to human-readable messages</li>
          <li>Async toast updates (loading → success/error)</li>
          <li>Auto-timeout with appropriate durations per toast type</li>
        </ul>
      </div>
    </div>
  );
}
