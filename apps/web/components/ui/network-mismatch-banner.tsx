"use client";

import { TriangleAlert, ArrowRightLeft, X } from "lucide-react";
import { useWalletStore } from "@/lib/store/use-wallet-store";
import { APP_STELLAR_NETWORK } from "@/lib/stellar";
import { cn } from "@/lib/utils";

export function NetworkMismatchBanner() {
  const { networkMismatch, setNetworkMismatch } = useWalletStore();

  if (!networkMismatch) return null;

  return (
    <div className="w-full px-4 pt-4 animate-in fade-in slide-in-from-top-4 duration-500">
      <div 
        role="alert"
        aria-live="assertive"
        className={cn(
          "mx-auto max-w-7xl relative overflow-hidden",
          "rounded-[12px] border border-indigo-500/20 bg-zinc-900/90 backdrop-blur-md",
          "flex flex-col md:flex-row items-center justify-between gap-4 p-4 md:p-5",
          "transition-all duration-200 hover:border-indigo-500/40 shadow-xl shadow-indigo-500/5"
        )}
      >
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 border border-indigo-500/20">
            <TriangleAlert className="h-5 w-5 text-indigo-400" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-zinc-100 tracking-tight">
              Network Mismatch Detected
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Your wallet is connected to a different network. Switch to <span className="text-indigo-300 font-medium capitalize">{APP_STELLAR_NETWORK}</span> to continue with Lance.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <button
            onClick={() => window.location.reload()}
            className="flex-1 md:flex-none inline-flex items-center justify-center gap-2 rounded-[10px] bg-indigo-500 px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-indigo-600 active:scale-[0.98] shadow-lg shadow-indigo-500/20"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
            Switch Network
          </button>
          <button
            onClick={() => setNetworkMismatch(false)}
            aria-label="Dismiss warning"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-zinc-800 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Decorative background element */}
        <div className="absolute -right-12 -top-12 h-24 w-24 rounded-full bg-indigo-500/5 blur-3xl pointer-events-none" />
      </div>
    </div>
  );
}