"use client";

/**
 * TransactionTracker / SorobanSimulator – Visual progress indicator for the
 * Soroban transaction lifecycle: Build → Simulate → Sign → Submit → Confirm
 *
 * Designed with a "Technical Transparency" philosophy:
 *  - Premium glassmorphism aesthetics
 *  - Animated pulsing rings and progress bars
 *  - Deep-dive into raw XDR (unsigned vs signed)
 *  - Detailed simulation diagnostics (CPU, Memory, Ledger IO)
 *  - High-contrast success/error messaging with block explorer links
 */

import React, { useState, type ElementType } from "react";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";
import type { TxLifecycleStep } from "@/lib/job-registry";
import {
  CheckCircle,
  XCircle,
  Loader2,
  FileCode,
  Cpu,
  PenTool,
  Send,
  ShieldCheck,
  Terminal,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Info,
  Database,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Step Configuration ─────────────────────────────────────────────────────

interface StepDef {
  key: TxLifecycleStep;
  label: string;
  icon: ElementType;
  description: string;
}

const STEPS: StepDef[] = [
  { 
    key: "building", 
    label: "Build", 
    icon: FileCode,
    description: "Constructing XDR with contract arguments"
  },
  { 
    key: "simulating", 
    label: "Simulate", 
    icon: Cpu,
    description: "Estimating fees and validating success"
  },
  { 
    key: "signing", 
    label: "Sign", 
    icon: PenTool,
    description: "Waiting for secure wallet signature"
  },
  { 
    key: "submitting", 
    label: "Submit", 
    icon: Send,
    description: "Broadcasting to Soroban RPC node"
  },
  { 
    key: "confirming", 
    label: "Confirm", 
    icon: ShieldCheck,
    description: "Waiting for on-chain finality"
  },
];

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

// ─── Explorer URL ───────────────────────────────────────────────────────────

const STELLAR_EXPLORER_URL =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "PUBLIC"
    ? "https://stellar.expert/explorer/public/tx"
    : "https://stellar.expert/explorer/testnet/tx";

// ─── Sub-Components ─────────────────────────────────────────────────────────

function XdrViewer({ label, xdr, type }: { label: string; xdr: string | null; type: "unsigned" | "signed" }) {
  const [expanded, setExpanded] = useState(false);
  if (!xdr) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50 transition-all">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:bg-white/5"
      >
        <div className="flex items-center gap-2">
          <Terminal className={cn("h-3 w-3", type === "signed" ? "text-emerald-400" : "text-amber-400")} />
          <span>{label}</span>
        </div>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="relative p-4 pt-0">
          <div className="absolute right-4 top-0 rounded bg-slate-800 px-1.5 py-0.5 text-[8px] font-bold text-slate-400">
            BASE64
          </div>
          <pre className="mt-2 max-h-40 overflow-y-auto break-all font-mono text-[10px] leading-relaxed text-slate-300 scrollbar-thin scrollbar-thumb-slate-800">
            {xdr}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function TransactionTracker() {
  const { step, detail, txHash, unsignedXdr, signedXdr, simulation, startedAt, finishedAt } =
    useTxStatusStore();

  // Nothing to show when idle
  if (step === "idle") return null;

  const currentIdx = STEP_INDEX[step as TxLifecycleStep];
  const isFailed = step === "failed";
  const isConfirmed = step === "confirmed";
  const elapsed =
    startedAt && finishedAt ? ((finishedAt - startedAt) / 1000).toFixed(1) : null;

  return (
    <div className="overflow-hidden rounded-[2.5rem] border border-slate-200/60 bg-white/70 p-1 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] backdrop-blur-2xl transition-all duration-500">
      <div className="rounded-[2.25rem] bg-gradient-to-b from-white to-slate-50/50 p-6 sm:p-8">
        
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-slate-900">
              Soroban Transaction Simulator
            </h3>
            <p className="text-xs font-medium text-slate-500">
              Technical Transparency Layer
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-amber-400 shadow-xl shadow-amber-400/10">
            <Activity className="h-5 w-5 animate-pulse" />
          </div>
        </div>

        {/* ── Progress Steps ────────────────────────────────────────────── */}
        <div className="mb-10">
          <div className="relative flex items-center justify-between px-2">
            {/* Background Line */}
            <div className="absolute left-0 right-0 top-5 h-[2px] bg-slate-100" />
            
            {/* Progress Fill */}
            <div 
              className={cn(
                "absolute left-0 top-5 h-[2px] transition-all duration-700 ease-in-out",
                isFailed ? "bg-red-400" : isConfirmed ? "bg-emerald-400" : "bg-amber-400"
              )}
              style={{ 
                width: `${Math.min(100, ((currentIdx + (isConfirmed ? 1 : 0)) / (STEPS.length - 1)) * 100)}%` 
              }}
            />

            {STEPS.map((s, idx) => {
              const isActive = currentIdx === idx;
              const isCompleted = currentIdx > idx || isConfirmed;
              const Icon = s.icon;

              return (
                <div key={s.key} className="group relative flex flex-col items-center">
                  <div
                    className={cn(
                      "relative z-10 flex h-10 w-10 items-center justify-center rounded-2xl border-2 transition-all duration-500",
                      isCompleted 
                        ? "border-emerald-500 bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" 
                        : isActive 
                          ? "border-amber-400 bg-amber-400 text-slate-950 shadow-lg shadow-amber-400/20" 
                          : "border-slate-200 bg-white text-slate-400"
                    )}
                  >
                    {isCompleted ? (
                      <CheckCircle className="h-5 w-5" />
                    ) : isActive ? (
                      <>
                        <span className="absolute inset-0 animate-ping rounded-2xl border-2 border-amber-400/60" />
                        <Icon className="h-5 w-5" />
                      </>
                    ) : (
                      <Icon className="h-5 w-5" />
                    )}
                  </div>
                  
                  <div className="absolute -bottom-8 flex flex-col items-center whitespace-nowrap">
                    <span
                      className={cn(
                        "text-[10px] font-bold uppercase tracking-wider transition-colors",
                        isCompleted ? "text-emerald-600" : isActive ? "text-amber-600" : "text-slate-400"
                      )}
                    >
                      {s.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Status Message ─────────────────────────────────────────────── */}
        <div className="mt-14">
          {isConfirmed && (
            <div className="group relative overflow-hidden rounded-[2rem] border border-emerald-200 bg-emerald-50/50 p-5 transition-all hover:bg-emerald-50">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/20">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-emerald-900">Success! Transaction Confirmed</h4>
                  <p className="text-xs text-emerald-700/70">Finalized on the decentralized ledger.</p>
                </div>
                {elapsed && (
                  <div className="ml-auto flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-bold text-emerald-700">
                    <Loader2 className="h-3 w-3" />
                    {elapsed}S
                  </div>
                )}
              </div>
              {txHash && (
                <a
                  href={`${STELLAR_EXPLORER_URL}/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 flex items-center justify-between rounded-xl bg-white/60 p-3 font-mono text-[11px] text-emerald-800 transition-colors hover:bg-white"
                >
                  <span className="truncate pr-4">{txHash}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
              )}
            </div>
          )}

          {isFailed && (
            <div className="rounded-[2rem] border border-rose-200 bg-rose-50/50 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-500 text-white">
                  <XCircle className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-rose-900">Transaction Failed</h4>
                  <p className="text-xs text-rose-700/70">The network rejected the operation.</p>
                </div>
              </div>
              {detail && (
                <div className="mt-4 rounded-xl bg-white/60 p-4 font-mono text-[11px] leading-relaxed text-rose-800">
                  {detail}
                </div>
              )}
            </div>
          )}

          {!isConfirmed && !isFailed && (
            <div className="flex items-center gap-4 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900">
                <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  {STEPS.find(s => s.key === step)?.label || "Processing"}...
                </h4>
                <p className="text-xs text-slate-500">
                  {STEPS.find(s => s.key === step)?.description || "Working on your request"}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Simulation Diagnostics ─────────────────────────────────────── */}
        {simulation && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-2 px-1">
              <Database className="h-3.5 w-3.5 text-slate-400" />
              <h5 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Simulation Diagnostics
              </h5>
            </div>
            
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-3">
                <span className="text-[9px] font-bold uppercase text-slate-400">Fee (XLM)</span>
                <p className="mt-1 font-mono text-xs font-bold text-slate-900">
                  {`${(Number(simulation.fee) / 10_000_000).toFixed(4)}`}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-3">
                <span className="text-[9px] font-bold uppercase text-slate-400">CPU (Inst)</span>
                <p className="mt-1 font-mono text-xs font-bold text-slate-900">
                  {Number(simulation.cpuInstructions).toLocaleString()}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-3">
                <span className="text-[9px] font-bold uppercase text-slate-400">Memory</span>
                <p className="mt-1 font-mono text-xs font-bold text-slate-900">
                  {simulation.memoryBytes === "0" ? "Minimal" : `${(Number(simulation.memoryBytes) / 1024).toFixed(1)} KB`}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-3">
                <span className="text-[9px] font-bold uppercase text-slate-400">IO (R/W)</span>
                <p className="mt-1 font-mono text-xs font-bold text-slate-900">
                  {simulation.readBytes ?? 0}/{simulation.writeBytes ?? 0}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Technical Transparency (XDR) ─────────────────────────────────── */}
        {(unsignedXdr || signedXdr) && (
          <div className="mt-8 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-2 px-1 mb-2">
              <Info className="h-3.5 w-3.5 text-slate-400" />
              <h5 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Transaction Integrity
              </h5>
            </div>
            <XdrViewer label="Unsigned XDR (Raw Build)" xdr={unsignedXdr} type="unsigned" />
            <XdrViewer label="Signed XDR (Validated)" xdr={signedXdr} type="signed" />
            <p className="mt-4 px-2 text-[10px] leading-relaxed text-slate-400 italic">
              * The XDR (External Data Representation) is the exact character-sequence being broadcast to the Stellar ledger.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
