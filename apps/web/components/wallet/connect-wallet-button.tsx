"use client";

import { AlertTriangle, Loader2, Wallet, WifiOff } from "lucide-react";
import { useWalletSession } from "@/hooks/use-wallet-session";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
      <Button
        variant="outline"
        size="sm"
        disabled
        aria-label="Checking wallet connection…"
        className={cn(
          "rounded-full border-zinc-700/60 bg-zinc-900/50 text-zinc-400",
          className,
        )}
      >
        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        <span className="text-xs">Checking…</span>
      </Button>
    );
  }

  if (isConnected && address) {
    const truncated = `${address.slice(0, 4)}…${address.slice(-4)}`;

    return (
      <div className={cn("flex flex-col items-end gap-1", className)}>
        {networkMismatch && (
          <p
            role="alert"
            aria-live="polite"
            className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-400"
          >
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            Wallet on {walletNetwork} — app on {appNetwork}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void disconnect()}
            aria-label={`Disconnect wallet ${truncated}`}
            className="rounded-full border-zinc-700/60 bg-zinc-900/50 text-xs text-zinc-300 transition-colors duration-200 hover:border-zinc-600 hover:bg-zinc-800 hover:text-white"
          >
            <Wallet className="mr-1.5 h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
            <span className="font-mono">{truncated}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void disconnect()}
            aria-label="Disconnect wallet"
            className="rounded-full text-xs text-zinc-500 transition-opacity duration-200 hover:text-zinc-300"
          >
            <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Disconnect</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      {error && (
        <p
          role="alert"
          aria-live="assertive"
          className="flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-0.5 text-[11px] font-medium text-red-400"
        >
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          {error}
        </p>
      )}

      <Button
        size="sm"
        onClick={() => void connect()}
        disabled={isConnecting}
        aria-label="Connect Stellar wallet"
        aria-busy={isConnecting}
        className="rounded-full bg-indigo-600 text-xs font-medium text-white shadow-sm shadow-indigo-500/30 transition-all duration-200 hover:bg-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 disabled:opacity-60"
      >
        {isConnecting ? (
          <>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Connecting…
          </>
        ) : (
          <>
            <Wallet className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Connect Wallet
          </>
        )}
      </Button>
    </div>
  );
}
