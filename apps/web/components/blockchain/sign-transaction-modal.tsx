"use client";

import { useEffect, useState, useMemo } from "react";
import { 
  ShieldCheck, 
  X, 
  Info, 
  Cpu, 
  Wallet, 
  ArrowRightLeft, 
  Clock, 
  AlertCircle 
} from "lucide-react";
import { cn } from "@/lib/utils";
import { 
  decodeTransaction, 
  type DecodedTransaction, 
  type DecodedOperation 
} from "@/lib/stellar";
import { useWalletStore } from "@/lib/store/use-wallet-store";

interface SignTransactionModalProps {
  xdr: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SignTransactionModal({ xdr, onConfirm, onCancel }: SignTransactionModalProps) {
  const decoded = useMemo(() => {
    if (!xdr) return null;
    try {
      return decodeTransaction(xdr);
    } catch (err) {
      console.error("Failed to decode XDR:", err);
      return null;
    }
  }, [xdr]);

  useEffect(() => {
    if (xdr && decoded) {
      // Small delay to trigger entry animation
      const timer = setTimeout(() => setIsVisible(true), 10);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [xdr, decoded]);

  if (!xdr || !decoded) return null;

  const truncateAddress = (addr: string) =>
    `${addr.slice(0, 8)}...${addr.slice(-8)}`;

  return (
    <div 
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-sm transition-opacity duration-300",
        isVisible ? "opacity-100" : "opacity-0 pointer-events-none"
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div 
        className={cn(
          "bg-zinc-900 w-full max-w-lg rounded-[12px] border border-zinc-800 shadow-2xl overflow-hidden transition-all duration-300 transform",
          isVisible ? "translate-y-0 scale-100" : "translate-y-4 scale-95"
        )}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-lg">
              <ShieldCheck className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 id="modal-title" className="text-zinc-100 font-semibold tracking-tight">
                Sign Transaction
              </h2>
              <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
                {decoded.network} Network
              </p>
            </div>
          </div>
          <button 
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[60vh] scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
          {/* Transaction Overview */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1.5">
                <Wallet className="w-3 h-3" /> Source Account
              </span>
              <p className="text-sm text-zinc-300 font-mono bg-zinc-800/50 px-2 py-1 rounded border border-zinc-700/30">
                {truncateAddress(decoded.source)}
              </p>
            </div>
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1.5">
                <Clock className="w-3 h-3" /> Sequence
              </span>
              <p className="text-sm text-zinc-300 font-mono bg-zinc-800/50 px-2 py-1 rounded border border-zinc-700/30">
                {decoded.sequence}
              </p>
            </div>
          </div>

          {/* Operations List */}
          <div className="space-y-3">
            <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1.5">
              <ArrowRightLeft className="w-3 h-3" /> Operations ({decoded.operations.length})
            </span>
            <div className="space-y-2">
              {decoded.operations.map((op, idx) => (
                <div 
                  key={idx} 
                  className="p-4 bg-zinc-800/30 border border-zinc-800 rounded-[12px] space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-zinc-200 capitalize">
                      {op.type.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                    <span className="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full border border-zinc-700">
                      Op #{idx + 1}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-1">
                    {Object.entries(op).map(([key, value]) => {
                      if (key === 'type') return null;
                      return (
                        <div key={key} className="flex justify-between text-xs">
                          <span className="text-zinc-500 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                          <span className="text-zinc-300 font-mono">{String(value)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Fee & Network */}
          <div className="p-4 bg-indigo-500/5 border border-indigo-500/10 rounded-[12px] flex items-start gap-4">
            <div className="p-2 bg-indigo-500/10 rounded-lg shrink-0">
              <Info className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="space-y-1">
              <p className="text-sm text-indigo-200 font-medium">Transaction Fee</p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-zinc-100">{decoded.fee}</span>
                <span className="text-xs text-zinc-500 font-mono">Stroops</span>
              </div>
              <p className="text-[11px] text-zinc-500">
                This fee will be deducted from your source account to process the transaction.
              </p>
            </div>
          </div>

          {/* Security Note */}
          <div className="flex items-center gap-2 text-[11px] text-zinc-500 italic">
            <AlertCircle className="w-3 h-3" />
            <span>Always verify the destination address and transaction amount before signing.</span>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-5 bg-zinc-950/40 border-t border-zinc-800 flex gap-3">
          <button 
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-[12px] text-sm font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all duration-200 border border-zinc-800"
          >
            Cancel
          </button>
          <button 
            onClick={onConfirm}
            className="flex-1 px-4 py-2.5 rounded-[12px] text-sm font-semibold text-white bg-indigo-500 hover:bg-indigo-600 transition-all duration-200 shadow-[0_0_20px_-5px_rgba(79,70,229,0.5)] focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-zinc-900"
          >
            Confirm & Sign
          </button>
        </div>
      </div>
    </div>
  );
}
