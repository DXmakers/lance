"use client";

import { AlertTriangle, Loader2, Wallet, WifiOff, Shield } from "lucide-react";
import { useWalletSession } from "@/hooks/use-wallet-session";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WalletErrorBanner } from "./wallet-error-display";
import { shortenAddress } from "@/lib/format";

interface ConnectWalletButtonProps {
  className?: string;
}

/**
 * Connect Wallet button — Issue #102
 *
 * Uses `useWalletSession` to manage connection state and surfaces:
 * - Loading skeleton while restoring a cached session
 * - Network mismatch warning when the wallet is on a different network
 * - Error message on connection failure
 * - Connected state with truncated address and disconnect action
 * - Disconnected state with connect action
 *
 * Fully keyboard-navigable and WCAG 2.1 AA compliant.
 */
export function ConnectWalletButton({ className }: ConnectWalletButtonProps) {
  const {
    address,
    appNetwork,
    walletNetwork,
    isConnected,
    isLoading,
    isConnecting,
    networkMismatch,
    error,
    connect,
    disconnect,
  } = useWalletSession();

  if (isLoading) {
    return (
      <div className={cn("flex flex-col items-end gap-2 responsive-gap", className)}>
        <Button
          variant="outline"
          size="sm"
          disabled
          aria-label="Checking wallet connection…"
          aria-describedby="loading-status"
          className="rounded-[12px] border-zinc-700/60 bg-zinc-900/50 text-zinc-400 transition-all duration-200 min-h-[32px] px-4"
        >
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          <span className="responsive-text-xs">Checking…</span>
        </Button>
        <div 
          id="loading-status"
          className="flex items-center gap-1.5 text-[10px] text-zinc-500 responsive-text-xs"
          role="status"
          aria-live="polite"
        >
          <Shield className="h-3 w-3" aria-hidden="true" />
          <span>Securing connection</span>
        </div>
      </div>
    );
  }

  if (isConnected && address) {
    const truncated = shortenAddress(address, 4, 4);

    return (
      <div className={cn("flex flex-col items-end gap-1 responsive-gap", className)}>
        {networkMismatch && (
          <div className="flex flex-col gap-1">
            <p
              role="alert"
              aria-live="polite"
              className="flex items-center gap-1 rounded-[12px] bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-400 responsive-text-xs"
            >
              <AlertTriangle className="h-3 w-3 animate-pulse" aria-hidden="true" />
              Network mismatch detected
            </p>
            <p className="text-[10px] text-zinc-500 text-right responsive-text-xs max-w-[200px]">
              Wallet: {walletNetwork} | App: {appNetwork}
            </p>
            <p className="text-[9px] text-amber-500 text-right responsive-text-xs max-w-[200px]">
              Please switch your wallet network to match
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 responsive-gap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void disconnect()}
            aria-label={`Disconnect wallet ${truncated}`}
            className="rounded-[12px] border-zinc-700/60 bg-zinc-900/50 text-xs text-zinc-300 transition-all duration-200 hover:border-indigo-500/50 hover:bg-zinc-800 hover:text-white group min-h-[32px] px-4"
          >
            <Wallet className="mr-1.5 h-3.5 w-3.5 text-indigo-400 group-hover:text-indigo-300 transition-colors" aria-hidden="true" />
            <span className="font-mono responsive-text-xs">{truncated}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void disconnect()}
            aria-label="Disconnect wallet"
            className="rounded-[12px] text-xs text-zinc-500 transition-all duration-200 hover:text-red-400 hover:bg-red-500/10 min-h-[32px] px-2"
          >
            <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Disconnect</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-end gap-2 responsive-gap", className)}>
      {error && (
        <WalletErrorBanner 
          error={error} 
          onRetry={() => void connect()}
          className="w-full max-w-xs"
        />
      )}

      <Button
        size="sm"
        onClick={() => void connect()}
        disabled={isConnecting}
        aria-label="Connect Stellar wallet"
        aria-busy={isConnecting}
        aria-describedby={isConnecting ? "connection-status" : undefined}
        className="rounded-[12px] bg-indigo-600 text-xs font-medium text-white shadow-sm shadow-indigo-500/30 transition-all duration-200 hover:bg-indigo-500 hover:shadow-indigo-400/40 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 disabled:opacity-60 disabled:cursor-not-allowed group relative overflow-hidden min-h-[32px] px-4"
      >
        {isConnecting ? (
          <div className="flex items-center">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            <span className="responsive-text-xs">Connecting…</span>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out"></div>
          </div>
        ) : (
          <div className="flex items-center">
            <Wallet className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            <span className="responsive-text-xs">Connect Wallet</span>
          </div>
        )}
      </Button>
      
      {isConnecting && (
        <div 
          id="connection-status"
          className="flex items-center gap-1.5 text-[10px] text-zinc-500 responsive-text-xs"
          role="status"
          aria-live="polite"
        >
          <Shield className="h-3 w-3 animate-pulse" aria-hidden="true" />
          <span>Establishing secure connection</span>
        </div>
      )}
    </div>
  );
}
