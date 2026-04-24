"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useWalletStore } from "@/lib/store/use-wallet-store";
import { connectWallet, getWalletsKit, signAuthMessage } from "@/lib/stellar";
import { Loader2, Wallet, LogOut, AlertCircle, ChevronRight, User } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function WalletConnect() {
  const { 
    publicKey, 
    isConnected, 
    isConnecting, 
    setConnecting, 
    setConnection, 
    disconnect, 
    setError,
    error 
  } = useWalletStore();

  const [isHydrated, setIsHydrated] = useState(false);

  // Handle hydration to avoid mismatch in Next.js
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    
    try {
      const address = await connectWallet();
      
      // SIWS Flow (Sign-In With Stellar)
      // 1. Generate nonce/message (mocked here, usually from backend)
      const message = `Sign in to Lance\n\nDomain: lance.so\nAddress: ${address}\nNonce: ${Math.random().toString(36).substring(2)}`;
      
      // 2. Sign message
      await signAuthMessage(message);
      
      // 3. Check Network
      const connectedNetwork = await kit.getNetwork();
      const appNetwork = (process.env.NEXT_PUBLIC_STELLAR_NETWORK as string) ?? "TESTNET";
      
      if (connectedNetwork.network.toUpperCase() !== appNetwork.toUpperCase()) {
        toast.warning(`Network mismatch: Wallet is on ${connectedNetwork.network}, but app is on ${appNetwork}`);
      }
      
      setConnection(address, walletId);
      toast.success("Wallet connected successfully");
    } catch (err: any) {
      const errorMessage = err.message || "Failed to connect wallet";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setConnecting(false);
    }
  };

  if (!isHydrated) return null;

  if (isConnected && publicKey) {
    return (
      <div className="flex items-center gap-2 animate-in fade-in duration-300">
        <div className="flex items-center gap-3 rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 ring-1 ring-white/5 backdrop-blur-md">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-400">
            <User className="h-3.5 w-3.5" />
          </div>
          <span className="text-sm font-medium text-zinc-200 font-mono">
            {publicKey.slice(0, 4)}...{publicKey.slice(-4)}
          </span>
          <div className="h-3 w-[1px] bg-zinc-800" />
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => disconnect()}
            aria-label="Disconnect wallet"
            className="h-7 rounded-full px-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-all duration-200"
          >
            <LogOut className="mr-1.5 h-3 w-3" />
            Disconnect
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        onClick={handleConnect}
        disabled={isConnecting}
        aria-label="Connect Stellar wallet"
        className={cn(
          "relative h-11 min-w-[160px] overflow-hidden rounded-xl border-none bg-indigo-600 px-6 font-medium text-white transition-all duration-200 hover:bg-indigo-500 hover:shadow-[0_0_20px_rgba(99,102,241,0.3)] disabled:opacity-70",
          "after:absolute after:inset-0 after:bg-gradient-to-r after:from-white/0 after:via-white/10 after:to-white/0 after:translate-x-[-100%] hover:after:translate-x-[100%] after:transition-transform after:duration-1000"
        )}
      >
        {isConnecting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Connecting...
          </>
        ) : (
          <>
            <Wallet className="mr-2 h-4 w-4" />
            Connect Wallet
            <ChevronRight className="ml-2 h-4 w-4 opacity-50" />
          </>
        )}
      </Button>
      
      {error && (
        <div className="flex items-center gap-2 px-2 text-[11px] font-medium text-red-400 animate-in slide-in-from-top-1 duration-200">
          <AlertCircle className="h-3 w-3" />
          {error}
        </div>
      )}
    </div>
  );
}
