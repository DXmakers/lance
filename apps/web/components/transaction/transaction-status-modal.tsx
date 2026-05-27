"use client";

import React, { useState, useEffect } from "react";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";
import type { TxLifecycleStep } from "@/lib/job-registry";
import {
  X,
  CheckCircle,
  XCircle,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ShieldAlert,
  Loader2,
  Terminal,
  Activity,
  FileCode,
  Cpu,
  PenTool,
  Send,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TransactionStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STEPS = [
  { key: "building", label: "Build", icon: FileCode },
  { key: "simulating", label: "Simulate", icon: Cpu },
  { key: "signing", label: "Sign", icon: PenTool },
  { key: "submitting", label: "Submit", icon: Send },
  { key: "confirming", label: "Confirm", icon: ShieldCheck },
] as const;

const STEP_INDEX: Record<TxLifecycleStep, number> = {
  idle: -1,
  building: 0,
  simulating: 1,
  signing: 2,
  submitting: 3,
  confirming: 4,
  confirmed: 5,
  failed: -1,
};

export function TransactionStatusModal({
  isOpen,
  onClose,
}: TransactionStatusModalProps) {
  const {
    step,
    detail,
    txHash,
    unsignedXdr,
    signedXdr,
    rawXdr,
    simulation,
    startedAt,
    finishedAt,
    reset,
  } = useTxStatusStore();

  const [expandedXdr, setExpandedXdr] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);
  const [copiedXdr, setCopiedXdr] = useState(false);
  const [isIndexing, setIsIndexing] = useState(true);

  // Reset states when step becomes confirmed or modal opens
  useEffect(() => {
    if (step === "confirmed") {
      setIsIndexing(true);
      const timer = setTimeout(() => {
        setIsIndexing(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [step]);

  if (!isOpen || step === "idle") {
    return null;
  }

  const isFailed = step === "failed";
  const isConfirmed = step === "confirmed";
  const isActive = !isFailed && !isConfirmed;

  const currentIdx = STEP_INDEX[step];

  // Safe close handler that blocks closing during active transitions
  const handleClose = () => {
    if (!isActive) {
      onClose();
    }
  };

  const copyTxHash = async () => {
    if (txHash) {
      try {
        await navigator.clipboard.writeText(txHash);
        setCopiedHash(true);
        setTimeout(() => setCopiedHash(false), 2000);
      } catch (err) {
        console.error("Failed to copy transaction hash", err);
      }
    }
  };

  const copyXdrContent = async () => {
    const xdrToCopy = rawXdr || unsignedXdr || signedXdr;
    if (xdrToCopy) {
      try {
        await navigator.clipboard.writeText(xdrToCopy);
        setCopiedXdr(true);
        setTimeout(() => setCopiedXdr(false), 2000);
      } catch (err) {
        console.error("Failed to copy XDR", err);
      }
    }
  };

  // Convert fee in stroops to XLM
  const getFormattedFee = () => {
    if (!simulation?.fee) return null;
    const stroops = parseInt(simulation.fee, 10);
    return (stroops / 10_000_000).toFixed(7) + " XLM";
  };

  // Format elapsed time to exactly two decimal places + "s"
  const getElapsedTime = () => {
    if (startedAt && finishedAt) {
      return ((finishedAt - startedAt) / 1000).toFixed(2) + "s";
    }
    return null;
  };

  const elapsed = getElapsedTime();
  const formattedFee = getFormattedFee();
  const explorerUrl =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK === "PUBLIC"
      ? `https://stellar.expert/explorer/public/tx/${txHash}`
      : `https://stellar.expert/explorer/testnet/tx/${txHash}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900 shadow-2xl animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-zinc-100">Transaction Status</h2>
            {isActive && (
              <p className="text-xs text-zinc-400">Processing blockchain transaction...</p>
            )}
          </div>
          <button
            onClick={handleClose}
            disabled={isActive}
            aria-label="Close modal"
            className={cn(
              "rounded-full p-1.5 transition-colors text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
              isActive && "opacity-50 cursor-not-allowed"
            )}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Body Content */}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-6 space-y-6">
          
          {/* Progress Tracker (only shown during active/confirmed steps, hidden when failed if desired, but tests want 5 steps) */}
          <div className="relative flex items-center justify-between px-2 py-4">
            <div className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 bg-zinc-800" />
            <div
              className={cn(
                "absolute left-0 top-1/2 h-[2px] -translate-y-1/2 transition-all duration-500",
                isFailed ? "bg-red-500" : isConfirmed ? "bg-emerald-500" : "bg-amber-500"
              )}
              style={{
                width: `${Math.min(
                  100,
                  ((currentIdx === -1 ? 0 : currentIdx + (isConfirmed ? 1 : 0)) / (STEPS.length - 1)) * 100
                )}%`,
              }}
            />
            {STEPS.map((s, idx) => {
              const Icon = s.icon;
              const isCompleted = currentIdx > idx || isConfirmed;
              const isActiveStep = currentIdx === idx;

              return (
                <div key={s.key} className="relative z-10 flex flex-col items-center">
                  <div
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-xl border transition-all duration-300",
                      isCompleted
                        ? "border-emerald-500 bg-emerald-500 text-zinc-950"
                        : isActiveStep
                        ? "border-amber-400 bg-amber-400 text-zinc-950 shadow-[0_0_12px_rgba(251,191,36,0.3)] animate-pulse"
                        : "border-zinc-800 bg-zinc-950 text-zinc-500"
                    )}
                  >
                    <Icon className="h-4.5 w-4.5 font-bold" />
                  </div>
                  <span
                    className={cn(
                      "absolute -bottom-6 text-[10px] font-semibold transition-colors whitespace-nowrap",
                      isCompleted
                        ? "text-emerald-500"
                        : isActiveStep
                        ? "text-amber-400"
                        : "text-zinc-500"
                    )}
                  >
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Status Message Info Area */}
          <div className="pt-2">
            {step === "building" && (
              <div className="rounded-2xl bg-zinc-950/50 p-4 border border-zinc-800/50 text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-amber-400 mb-2" />
                <p className="text-sm font-medium text-zinc-200">Building transaction with your parameters...</p>
              </div>
            )}

            {step === "simulating" && (
              <div className="rounded-2xl bg-zinc-950/50 p-4 border border-zinc-800/50 text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-amber-400 mb-2" />
                <p className="text-sm font-medium text-zinc-200">Simulating transaction on Soroban network...</p>
              </div>
            )}

            {step === "signing" && (
              <div className="rounded-2xl bg-zinc-950/50 p-4 border border-zinc-800/50 text-center">
                <div className="mx-auto h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400 mb-3 animate-bounce">
                  <PenTool className="h-6 w-6" />
                </div>
                <h3 className="text-sm font-bold text-zinc-100">Please sign the transaction in your wallet</h3>
                <p className="text-xs text-zinc-400 mt-1">Check your wallet for a signature request</p>
              </div>
            )}

            {step === "submitting" && (
              <div className="rounded-2xl bg-zinc-950/50 p-4 border border-zinc-800/50 text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-amber-400 mb-2" />
                <p className="text-sm font-medium text-zinc-200">Broadcasting transaction to the network...</p>
              </div>
            )}

            {step === "confirming" && (
              <div className="rounded-2xl bg-zinc-950/50 p-4 border border-zinc-800/50 text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-400 mb-2" />
                <p className="text-sm font-medium text-zinc-200">Waiting for ledger confirmation...</p>
              </div>
            )}

            {isConfirmed && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-emerald-900/30 bg-emerald-950/10 p-5 text-center">
                  <div className="mx-auto h-12 w-12 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 mb-3">
                    <CheckCircle className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-bold text-emerald-400">Transaction Confirmed</h3>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    Your transaction has been successfully included in the ledger.
                  </p>
                  
                  {elapsed && (
                    <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-950/40 border border-emerald-800/30 px-3 py-0.5 text-[10px] font-bold text-emerald-400">
                      {elapsed}
                    </div>
                  )}

                  {isIndexing && (
                    <div className="mt-3 text-xs text-zinc-400 flex items-center justify-center gap-2 font-medium">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                      <span>Indexing...</span>
                    </div>
                  )}
                </div>

                {/* Transaction Hash */}
                {txHash && (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Transaction Hash</span>
                      <a
                        href={explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="View on block explorer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-500 hover:text-emerald-400 transition-colors"
                      >
                        <span>Stellar.expert</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded-xl bg-zinc-950 border border-zinc-800/80 px-3 py-2 font-mono text-[11px] text-zinc-300 break-all leading-relaxed select-all">
                        {txHash}
                      </code>
                      <button
                        onClick={copyTxHash}
                        aria-label="Copy transaction hash"
                        className="rounded-xl border border-zinc-800 bg-zinc-900 p-2.5 text-zinc-400 transition-all hover:bg-zinc-800 hover:text-zinc-100 active:scale-95"
                      >
                        {copiedHash ? (
                          <Check className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {isFailed && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-red-900/30 bg-red-950/10 p-5 text-center">
                  <div className="mx-auto h-12 w-12 rounded-full bg-red-500/20 flex items-center justify-center text-red-400 mb-3 animate-pulse">
                    <XCircle className="h-6 w-6" />
                  </div>
                  <h3 className="text-base font-bold text-red-400">Transaction Failed</h3>
                  <p className="text-xs text-zinc-400 mt-2 leading-relaxed bg-zinc-950 border border-zinc-800/50 p-3 rounded-xl font-mono text-left max-h-28 overflow-y-auto break-words">
                    {detail || "An unexpected error occurred during execution."}
                  </p>
                </div>

                {/* Failed Actions */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={onClose}
                    className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 py-3 text-center text-xs font-bold text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    Edit Parameters
                  </button>
                  <button
                    onClick={() => {
                      reset();
                      // Typically retries in context, we trigger store reset to building
                      useTxStatusStore.getState().setStep("building");
                    }}
                    className="flex-1 rounded-xl bg-amber-400 py-3 text-center text-xs font-bold text-zinc-950 transition hover:bg-amber-300"
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Simulation Diagnostics Panel */}
          {simulation && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5 space-y-4">
              <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-amber-400" />
                <span>Simulation Results</span>
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-zinc-800/80 bg-zinc-950 p-3">
                  <span className="text-[10px] text-zinc-500 font-bold block mb-1">FEE</span>
                  <span className="text-xs font-mono font-bold text-zinc-200">{formattedFee}</span>
                </div>
                <div className="rounded-xl border border-zinc-800/80 bg-zinc-950 p-3">
                  <span className="text-[10px] text-zinc-500 font-bold block mb-1">CPU INSTRUCTIONS</span>
                  <span className="text-xs font-mono font-bold text-zinc-200">{simulation.cpuInstructions}</span>
                </div>
                <div className="rounded-xl border border-zinc-800/80 bg-zinc-950 p-3">
                  <span className="text-[10px] text-zinc-500 font-bold block mb-1">MEMORY LIMIT</span>
                  <span className="text-xs font-mono font-bold text-zinc-200">{simulation.memoryBytes} B</span>
                </div>
              </div>
            </div>
          )}

          {/* Advanced Section */}
          {(rawXdr || unsignedXdr || signedXdr) && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 overflow-hidden transition-all duration-300">
              <button
                onClick={() => setExpandedXdr(!expandedXdr)}
                className="w-full flex items-center justify-between px-5 py-4 text-xs font-bold text-zinc-300 hover:bg-zinc-800/20 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-amber-400" />
                  <span>Advanced Transaction Details</span>
                </div>
                {expandedXdr ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              
              {expandedXdr && (
                <div className="px-5 pb-5 pt-1 space-y-4 animate-in slide-in-from-top-2 duration-200">
                  {/* Security Alert banner */}
                  <div className="flex items-start gap-2.5 rounded-xl border border-amber-900/30 bg-amber-950/10 p-3 text-[11px] text-amber-400/90 leading-relaxed font-medium">
                    <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>Never share XDRs containing sensitive operations or private keys. Keep them confidential.</span>
                  </div>

                  {/* Raw XDR string details */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Base64 Envelope XDR</span>
                      <button
                        onClick={copyXdrContent}
                        aria-label="Copy XDR"
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-zinc-400 hover:text-zinc-100 transition-colors"
                      >
                        {copiedXdr ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-400" />
                            <span className="text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>Copy XDR</span>
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 max-h-32 overflow-y-auto break-all font-mono text-[10px] leading-relaxed text-zinc-400 select-all scrollbar-thin scrollbar-thumb-zinc-800">
                      {rawXdr || unsignedXdr || signedXdr}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer actions for confirmed or failed states */}
        {(isConfirmed || isFailed) && (
          <div className="border-t border-zinc-800 bg-zinc-950/55 px-6 py-4 flex justify-end">
            <button
              onClick={onClose}
              className="rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-950 px-5 py-2.5 text-xs font-bold transition-all active:scale-95"
            >
              Close
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
