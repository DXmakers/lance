"use client";

import { useWalletAuth } from "@/hooks/use-wallet-auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Loader2, LogOut, Wallet, AlertCircle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function WalletConnectButton({ className }: { className?: string }) {
  const {
    address,
    isConnected,
    isLoading,
    status,
    error,
    networkMismatch,
    connect,
    disconnect,
  } = useWalletAuth();

  // ── 1. Loading State ────────────────────────────────────────────────────────
  if (isLoading) {
    let loadingText = "Connecting...";
    if (status === "signing") loadingText = "Please sign in wallet";
    if (status === "verifying") loadingText = "Verifying signature...";

    return (
      <Button
        variant="outline"
        disabled
        className={cn(
          "h-10 min-w-[140px] rounded-xl border-border/70 bg-card/70 px-4 text-sm font-medium backdrop-blur transition-opacity duration-200",
          className
        )}
      >
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-muted-foreground" />
        <span className="animate-pulse">{loadingText}</span>
      </Button>
    );
  }

  // ── 2. Error State ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              onClick={connect}
              className={cn(
                "h-10 rounded-xl border-destructive/50 bg-destructive/10 px-4 text-sm font-medium text-destructive transition-all duration-200 hover:bg-destructive/20 hover:text-destructive",
                className
              )}
            >
              <AlertCircle className="mr-2 h-4 w-4" />
              Connection Failed
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[280px] border-destructive/20 bg-destructive/95 text-destructive-foreground">
            <p className="text-xs">{error}</p>
            <p className="mt-1 text-[10px] opacity-80">Click to try again</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // ── 3. Connected State ──────────────────────────────────────────────────────
  if (isConnected && address) {
    const truncatedAddress = `${address.slice(0, 4)}…${address.slice(-4)}`;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "group h-10 rounded-xl border-border/70 bg-card/70 px-4 text-sm font-medium backdrop-blur transition-all duration-200 hover:border-indigo-500/40 hover:bg-indigo-500/5",
              networkMismatch && "border-amber-500/50 hover:border-amber-500/70",
              className
            )}
          >
            {networkMismatch ? (
              <AlertCircle className="mr-2 h-4 w-4 text-amber-500" />
            ) : (
              <ShieldCheck className="mr-2 h-4 w-4 text-emerald-500 transition-transform duration-200 group-hover:scale-110" />
            )}
            <span className="font-mono tracking-tight">{truncatedAddress}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 rounded-xl">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <p className="text-xs font-medium leading-none">Connected Wallet</p>
              <p className="text-[10px] leading-none text-muted-foreground break-all pt-1">
                {address}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {networkMismatch ? (
            <div className="px-2 py-1.5 text-xs">
              <div className="flex items-start gap-2 text-amber-500">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <p>
                  Network mismatch! App expects{" "}
                  <strong className="font-semibold">{networkMismatch.appNetwork}</strong>{" "}
                  but wallet is on{" "}
                  <strong className="font-semibold">{networkMismatch.walletNetwork}</strong>.
                </p>
              </div>
            </div>
          ) : (
            <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Stellar {status === "connected" ? "Connected" : "Idle"}
              </span>
            </div>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={disconnect}
            className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4" />
            <span>Disconnect</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // ── 4. Idle State ───────────────────────────────────────────────────────────
  return (
    <Button
      onClick={connect}
      className={cn(
        "h-10 rounded-xl bg-zinc-900 px-5 text-sm font-medium text-zinc-50 shadow-sm transition-all duration-200 hover:bg-zinc-800 hover:shadow-indigo-500/20 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200",
        className
      )}
    >
      <Wallet className="mr-2 h-4 w-4" />
      Connect Wallet
    </Button>
  );
}
