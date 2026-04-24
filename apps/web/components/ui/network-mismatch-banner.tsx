"use client";

import { AlertTriangle, X } from "lucide-react";
import { useWallet } from "@/hooks/use-wallet";
import { cn } from "@/lib/utils";

interface NetworkMismatchBannerProps {
  className?: string;
}

export function NetworkMismatchBanner({ className }: NetworkMismatchBannerProps) {
  const { hasNetworkMismatch, setNetwork, network } = useWallet();

  if (!hasNetworkMismatch) return null;

  const correctNetwork = network === "TESTNET" ? "MAINNET" : "TESTNET";

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-label="Network mismatch warning"
      className={cn(
        "flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 transition-opacity duration-200",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <AlertTriangle 
          className="h-4 w-4 shrink-0 text-amber-400" 
          aria-hidden="true" 
        />
        <p className="text-sm text-amber-200">
          <span className="font-semibold">Network mismatch — </span>
          your wallet is connected to a different network than this app.
          Please switch your wallet to the correct network.
        </p>
      </div>
      <button
        onClick={() => setNetwork(correctNetwork)}
        className="rounded-full bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/30 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        aria-label={`Switch to ${correctNetwork}`}
      >
        Switch to {correctNetwork}
      </button>
    </div>
  );
}