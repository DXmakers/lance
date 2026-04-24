"use client";

import { useWallet } from "@/hooks/use-wallet";
import { Button } from "@/components/ui/button";
import { 
  Wallet, 
  ChevronDown, 
  LogOut, 
  Copy, 
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  AlertTriangle
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { WalletSelectionModal } from "./wallet-selection-modal";

export function WalletConnect() {
  const { 
    address, 
    status, 
    connect, 
    disconnect, 
    isConnected, 
    isConnecting,
    isModalOpen,
    setIsModalOpen,
    hasNetworkMismatch,
    network
  } = useWallet();

  const truncateAddress = (addr: string) => 
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      toast.success("Address copied to clipboard");
    }
  };

  const handleConnectClick = () => {
    setIsModalOpen(true);
  };

  if (!isConnected) {
    return (
      <>
        <Button
          onClick={handleConnectClick}
          disabled={isConnecting}
          aria-label={isConnecting ? "Connecting to wallet" : "Connect Stellar wallet"}
          className={cn(
            "relative h-11 rounded-[12px] bg-zinc-900 px-6 text-sm font-medium text-white transition-all duration-200 hover:bg-zinc-800 hover:shadow-[0_0_20px_rgba(99,102,241,0.15)] active:scale-[0.98] disabled:opacity-50",
            "border border-white/5 focus:ring-4 focus:ring-indigo-500/20"
          )}
        >
          {isConnecting ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin text-indigo-400" aria-hidden="true" />
              Connecting...
            </>
          ) : (
            <>
              <Wallet className="mr-2 h-4 w-4 text-indigo-400" aria-hidden="true" />
              Connect Wallet
            </>
          )}
        </Button>

        <WalletSelectionModal 
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSelect={connect}
        />
      </>
    );
  }

  return (
    <div className="relative">
      {hasNetworkMismatch && (
        <div
          role="alert"
          aria-live="polite"
          className="absolute -top-12 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-amber-500/20 border border-amber-500/30 px-3 py-1.5 text-xs text-amber-400 shadow-lg"
        >
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Network mismatch detected ({network})</span>
        </div>
      )}
      
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            aria-label={`Wallet connected. Address: ${address}. Click to open wallet menu.`}
            className={cn(
              "h-11 rounded-[12px] border-white/10 bg-zinc-900 px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-zinc-800 hover:border-indigo-500/30",
              "flex items-center gap-2 shadow-sm focus:ring-2 focus:ring-indigo-500/50"
            )}
          >
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/10">
              <div className={cn(
                "h-2 w-2 rounded-full shadow-[0_0_8px_#6366f1]",
                hasNetworkMismatch ? "bg-amber-500 animate-pulse" : "bg-indigo-500"
              )} />
            </div>
            <span className="hidden sm:inline-block font-mono">
              {truncateAddress(address!)}
            </span>
            <ChevronDown className="h-4 w-4 text-zinc-500" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent 
          align="end" 
          className="w-72 rounded-[12px] border-white/10 bg-zinc-900/95 p-2 text-zinc-400 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200"
        >
          <DropdownMenuLabel className="px-2 py-1.5">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Connected Address
              </span>
              <span className="text-sm font-mono text-zinc-200 truncate" aria-label={address!}>
                {address}
              </span>
            </div>
          </DropdownMenuLabel>
          
          {hasNetworkMismatch && (
            <div className="mx-2 mb-2 flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden="true" />
              <span className="text-[11px] font-medium text-amber-300">
                Network mismatch - app is on {network}
              </span>
            </div>
          )}
          
          <DropdownMenuSeparator className="bg-white/5" />
          <DropdownMenuItem 
            onSelect={copyAddress}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2.5 text-sm hover:bg-white/5 hover:text-white transition-colors focus:bg-white/5 focus:text-white"
          >
            <Copy className="h-4 w-4 text-indigo-400" aria-hidden="true" />
            <span>Copy Address</span>
          </DropdownMenuItem>
          <DropdownMenuItem 
            asChild
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2.5 text-sm hover:bg-white/5 hover:text-white transition-colors focus:bg-white/5 focus:text-white"
          >
            <a 
              href={`https://stellar.expert/explorer/testnet/account/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View account in Stellar Expert explorer"
            >
              <ExternalLink className="h-4 w-4 text-indigo-400" aria-hidden="true" />
              <span>View in Explorer</span>
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-white/5" />
          <div className="px-2 py-2">
            <div className="flex items-center gap-2 rounded-lg bg-indigo-500/5 border border-indigo-500/10 px-3 py-2">
              <ShieldCheck className="h-4 w-4 text-indigo-400" aria-hidden="true" />
              <span className="text-[11px] font-medium text-indigo-300">
                Secure Session Active
              </span>
            </div>
          </div>
          <DropdownMenuSeparator className="bg-white/5" />
          <DropdownMenuItem 
            onSelect={disconnect}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2.5 text-sm text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors focus:bg-rose-500/10 focus:text-rose-300"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>Disconnect Wallet</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}