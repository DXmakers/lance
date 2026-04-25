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
  RefreshCw
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
    network,
    status, 
    connect, 
    disconnect, 
    isConnected, 
    isConnecting,
    isModalOpen,
    setIsModalOpen
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
            "relative h-11 rounded-[12px] bg-[#18181b] px-6 text-sm font-medium text-white transition-all duration-200 hover:bg-[#27272a] hover:shadow-[0_0_20px_rgba(99,102,241,0.15)] active:scale-[0.98] disabled:opacity-50",
            "border border-white/5 ring-indigo-500/20 focus:ring-4"
          )}
        >
          {isConnecting ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin text-indigo-400" />
              Connecting...
            </>
          ) : (
            <>
              <Wallet className="mr-2 h-4 w-4 text-indigo-400" />
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          aria-label={`Wallet connected: ${address}`}
          className={cn(
            "h-11 rounded-[12px] border-white/10 bg-[#18181b] px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-[#27272a] hover:border-indigo-500/30",
            "flex items-center gap-2 shadow-sm"
          )}
        >
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/10">
            <div className="h-2 w-2 rounded-full bg-indigo-500 shadow-[0_0_8px_#6366f1]" />
          </div>
          <span className="hidden sm:inline-block font-mono">
            {truncateAddress(address!)}
          </span>
          <ChevronDown className="h-4 w-4 text-zinc-500" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent 
        align="end" 
        className="w-64 rounded-[12px] border-white/10 bg-[#09090b] p-2 text-zinc-400 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200"
      >
        <DropdownMenuLabel className="px-2 py-1.5">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Connected Address
            </span>
            <span className="text-sm font-mono text-zinc-200 truncate">
              {address}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-white/5" />
        <DropdownMenuItem 
          onClick={copyAddress}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-white/5 hover:text-white transition-colors"
        >
          <Copy className="h-4 w-4 text-indigo-400" />
          Copy Address
        </DropdownMenuItem>
        <DropdownMenuItem 
          asChild
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-white/5 hover:text-white transition-colors"
        >
          <a 
            href={`${network === 'TESTNET' ? 'https://stellar.expert/explorer/testnet' : 'https://stellar.expert/explorer/public'}/account/${address}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-4 w-4 text-indigo-400" />
            View on Explorer
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-white/5" />
        <div className="px-2 py-2">
          <div className="flex items-center gap-2 rounded-lg bg-indigo-500/5 px-3 py-2 border border-indigo-500/10">
            <ShieldCheck className="h-4 w-4 text-indigo-400" />
            <span className="text-[11px] font-medium text-indigo-300">
              Verified Session
            </span>
          </div>
        </div>
        <DropdownMenuSeparator className="bg-white/5" />
        <DropdownMenuItem 
          onClick={disconnect}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}