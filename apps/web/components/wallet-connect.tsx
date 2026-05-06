"use client";

import { useWallet } from "@/hooks/use-wallet";
import { Button } from "@/components/ui/button";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Wallet, LogOut, ShieldCheck, ChevronDown, Loader2 } from "lucide-react";

export function WalletConnect() {
  const { connect, disconnect, isConnecting, isLoggedIn, address } = useWallet();

  if (isConnecting) {
    return (
      <Button disabled className="rounded-full bg-zinc-900 text-zinc-400 border border-zinc-800">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Connecting...
      </Button>
    );
  }

  if (!isLoggedIn) {
    return (
      <Button 
        onClick={connect}
        className="rounded-full bg-indigo-600 px-6 font-semibold text-white transition-all hover:bg-indigo-500 hover:shadow-[0_0_20px_rgba(79,70,229,0.4)] active:scale-95"
      >
        <Wallet className="mr-2 h-4 w-4" />
        Connect Wallet
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="outline" 
          className="rounded-full border-zinc-800 bg-zinc-900/50 px-4 text-zinc-100 hover:bg-zinc-800 hover:text-white"
        >
          <div className="mr-2 h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-mono text-xs">
            {address?.slice(0, 4)}...{address?.slice(-4)}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 text-zinc-500" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-xl border-zinc-800 bg-zinc-900 p-2 text-zinc-200 shadow-2xl">
        <div className="px-2 py-1.5 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          Connected Wallet
        </div>
        <div className="mb-2 px-2 py-1.5 text-sm font-mono text-zinc-100 break-all bg-zinc-800/50 rounded-lg">
          {address}
        </div>
        <DropdownMenuSeparator className="bg-zinc-800" />
        <DropdownMenuItem className="cursor-pointer rounded-lg focus:bg-zinc-800 focus:text-white">
          <ShieldCheck className="mr-2 h-4 w-4 text-indigo-400" />
          <span>Security Verified</span>
        </DropdownMenuItem>
        <DropdownMenuItem 
          onClick={disconnect}
          className="cursor-pointer rounded-lg text-rose-400 focus:bg-rose-500/10 focus:text-rose-400"
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>Disconnect</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
