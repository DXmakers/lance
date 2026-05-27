/**
 * Example Integration: TransactionStatusModal
 * 
 * This file demonstrates how to integrate the TransactionStatusModal
 * into your application with proper state management and lifecycle handling.
 */

"use client";

import { useState } from "react";
import { TransactionStatusModal } from "./transaction-status-modal";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";
import { postJob, submitBid } from "@/lib/job-registry";
import type { PostJobParams, SubmitBidParams } from "@/lib/job-registry";

// ─── Example 1: Post Job with Transaction Modal ────────────────────────────

export function PostJobExample() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { setStep, setTxHash, setRawXdr, setSimulation, reset } = useTxStatusStore();

  const handlePostJob = async () => {
    // Reset previous transaction state
    reset();
    
    // Open modal
    setIsModalOpen(true);

    const params: PostJobParams = {
      jobId: 0n, // Auto-allocate
      clientAddress: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      metadataHash: "QmYourIPFSHashHere",
      budgetStroops: 100_000_000n, // 10 USDC
    };

    try {
      const result = await postJob(params, (step, detail, metadata) => {
        // Update store on each lifecycle step
        setStep(step, detail);
        
        // Store XDR when available
        if (metadata?.rawXdr) {
          setRawXdr(metadata.rawXdr);
        }
      });

      // Store final transaction hash and simulation data
      setTxHash(result.txHash);
      setSimulation(result.simulation);
      
      console.log("Transaction confirmed:", result.txHash);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStep("failed", message);
      console.error("Transaction failed:", error);
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Post a Job</h2>
      <button
        onClick={handlePostJob}
        className="rounded-lg bg-blue-600 px-6 py-3 text-white font-medium hover:bg-blue-700 transition-colors"
      >
        Submit Job to Blockchain
      </button>

      <TransactionStatusModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}

// ─── Example 2: Submit Bid with Transaction Modal ──────────────────────────

export function SubmitBidExample() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { setStep, setTxHash, setRawXdr, setSimulation, reset } = useTxStatusStore();

  const handleSubmitBid = async () => {
    reset();
    setIsModalOpen(true);

    const params: SubmitBidParams = {
      jobId: 123n,
      freelancerAddress: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      proposalHash: "QmYourProposalHashHere",
    };

    try {
      const result = await submitBid(params, (step, detail, metadata) => {
        setStep(step, detail);
        if (metadata?.rawXdr) {
          setRawXdr(metadata.rawXdr);
        }
      });

      setTxHash(result.txHash);
      setSimulation(result.simulation);
      
      console.log("Bid submitted:", result.txHash);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStep("failed", message);
      console.error("Bid submission failed:", error);
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Submit a Bid</h2>
      <button
        onClick={handleSubmitBid}
        className="rounded-lg bg-emerald-600 px-6 py-3 text-white font-medium hover:bg-emerald-700 transition-colors"
      >
        Submit Bid to Blockchain
      </button>

      <TransactionStatusModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}

// ─── Example 3: Custom Transaction with Manual State Updates ───────────────

export function CustomTransactionExample() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { setStep, setTxHash, setRawXdr, setSimulation, reset } = useTxStatusStore();

  const handleCustomTransaction = async () => {
    reset();
    setIsModalOpen(true);

    try {
      // Step 1: Building
      setStep("building");
      await simulateDelay(1000);
      setRawXdr("AAAAAAAAAABBBBBBBBBBCCCCCCCCCC..."); // Your XDR

      // Step 2: Simulating
      setStep("simulating");
      await simulateDelay(2000);
      setSimulation({
        fee: "1000000",
        cpuInstructions: "500000",
        memoryBytes: "2048",
      });

      // Step 3: Signing
      setStep("signing");
      await simulateDelay(3000); // User signs in wallet

      // Step 4: Submitting
      setStep("submitting");
      await simulateDelay(1500);

      // Step 5: Confirming
      setStep("confirming");
      await simulateDelay(5000); // Wait for ledger

      // Success
      const txHash = "abc123def456...";
      setTxHash(txHash);
      setStep("confirmed", txHash);
      
      console.log("Custom transaction confirmed:", txHash);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStep("failed", message);
      console.error("Custom transaction failed:", error);
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Custom Transaction</h2>
      <button
        onClick={handleCustomTransaction}
        className="rounded-lg bg-purple-600 px-6 py-3 text-white font-medium hover:bg-purple-700 transition-colors"
      >
        Execute Custom Transaction
      </button>

      <TransactionStatusModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}

// ─── Example 4: Multiple Transactions with Queue ───────────────────────────

export function TransactionQueueExample() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [queue, setQueue] = useState<string[]>([]);
  const { setStep, setTxHash, setSimulation, reset } = useTxStatusStore();

  const processTransaction = async (txName: string) => {
    reset();
    setIsModalOpen(true);

    try {
      setStep("building");
      await simulateDelay(1000);

      setStep("simulating");
      await simulateDelay(1500);
      setSimulation({
        fee: "1000000",
        cpuInstructions: "400000",
        memoryBytes: "1024",
      });

      setStep("signing");
      await simulateDelay(2000);

      setStep("submitting");
      await simulateDelay(1000);

      setStep("confirming");
      await simulateDelay(3000);

      const txHash = `${txName}-${Date.now()}`;
      setTxHash(txHash);
      setStep("confirmed", txHash);

      // Remove from queue
      setQueue((prev) => prev.filter((name) => name !== txName));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStep("failed", message);
    }
  };

  const addToQueue = (txName: string) => {
    setQueue((prev) => [...prev, txName]);
  };

  const processNext = () => {
    if (queue.length > 0) {
      processTransaction(queue[0]);
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Transaction Queue</h2>
      
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => addToQueue("TX-A")}
          className="rounded-lg bg-slate-600 px-4 py-2 text-white text-sm hover:bg-slate-700"
        >
          Add TX-A
        </button>
        <button
          onClick={() => addToQueue("TX-B")}
          className="rounded-lg bg-slate-600 px-4 py-2 text-white text-sm hover:bg-slate-700"
        >
          Add TX-B
        </button>
        <button
          onClick={() => addToQueue("TX-C")}
          className="rounded-lg bg-slate-600 px-4 py-2 text-white text-sm hover:bg-slate-700"
        >
          Add TX-C
        </button>
      </div>

      <div className="mb-4">
        <h3 className="text-sm font-semibold mb-2">Queue ({queue.length})</h3>
        <div className="flex gap-2">
          {queue.map((tx, idx) => (
            <span
              key={idx}
              className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800"
            >
              {tx}
            </span>
          ))}
        </div>
      </div>

      <button
        onClick={processNext}
        disabled={queue.length === 0}
        className="rounded-lg bg-blue-600 px-6 py-3 text-white font-medium hover:bg-blue-700 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
      >
        Process Next Transaction
      </button>

      <TransactionStatusModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}

// ─── Example 5: Error Handling Scenarios ───────────────────────────────────

export function ErrorHandlingExample() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { setStep, setSimulation, reset } = useTxStatusStore();

  const simulateError = async (errorType: "build" | "simulate" | "sign" | "submit") => {
    reset();
    setIsModalOpen(true);

    try {
      setStep("building");
      await simulateDelay(1000);

      if (errorType === "build") {
        throw new Error("Invalid transaction parameters: budget must be positive");
      }

      setStep("simulating");
      await simulateDelay(1500);

      if (errorType === "simulate") {
        setSimulation({
          fee: "1000000",
          cpuInstructions: "500000",
          memoryBytes: "2048",
        });
        throw new Error("Simulation failed: insufficient balance for fee (need 0.1 XLM, have 0.05 XLM)");
      }

      setStep("signing");
      await simulateDelay(2000);

      if (errorType === "sign") {
        throw new Error("User rejected the transaction signature request");
      }

      setStep("submitting");
      await simulateDelay(1000);

      if (errorType === "submit") {
        throw new Error("Network error: tx_bad_seq - Sequence number mismatch");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStep("failed", message);
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Error Scenarios</h2>
      
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => simulateError("build")}
          className="rounded-lg bg-red-600 px-4 py-2 text-white text-sm hover:bg-red-700"
        >
          Build Error
        </button>
        <button
          onClick={() => simulateError("simulate")}
          className="rounded-lg bg-orange-600 px-4 py-2 text-white text-sm hover:bg-orange-700"
        >
          Simulate Error
        </button>
        <button
          onClick={() => simulateError("sign")}
          className="rounded-lg bg-amber-600 px-4 py-2 text-white text-sm hover:bg-amber-700"
        >
          Sign Error
        </button>
        <button
          onClick={() => simulateError("submit")}
          className="rounded-lg bg-yellow-600 px-4 py-2 text-white text-sm hover:bg-yellow-700"
        >
          Submit Error
        </button>
      </div>

      <TransactionStatusModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}

// ─── Utility ────────────────────────────────────────────────────────────────

function simulateDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Combined Demo Page ─────────────────────────────────────────────────────

export function TransactionModalDemo() {
  return (
    <div className="min-h-screen bg-slate-50 py-12">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">
            Transaction Status Modal
          </h1>
          <p className="text-slate-600">
            Professional blockchain transaction lifecycle interface
          </p>
        </div>

        <div className="grid gap-6">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <PostJobExample />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <SubmitBidExample />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <CustomTransactionExample />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <TransactionQueueExample />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <ErrorHandlingExample />
          </div>
        </div>
      </div>
    </div>
  );
}
