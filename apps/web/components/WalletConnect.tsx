"use client";

import { useWallet } from "@/hooks/use-wallet";
import { Wallet, LogOut, CheckCircle2 } from "lucide-react";
import { ExplorerLink } from "@/components/ui/explorer-link";

export function WalletConnect() {
  const { address, network, isConnecting, connect, disconnect, setNetwork } = useWallet();

  const truncateAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <div className="bg-zinc-900 p-4 md:p-6 rounded-[12px] border border-zinc-800 shadow-xl max-w-sm w-full font-sans transition-opacity duration-200">
      <div className="flex flex-col space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-zinc-100 font-semibold text-lg flex items-center gap-2">
            <Wallet className="w-5 h-5 text-indigo-500" />
            Wallet Connection
          </h2>
          {address && (
            <div className="flex items-center gap-2 px-3 py-1 bg-zinc-800 rounded-full border border-zinc-700">
              <span className={`w-2 h-2 rounded-full ${network === "MAINNET" ? "bg-indigo-500" : "bg-zinc-400"}`} />
              <span className="text-xs text-zinc-300 font-medium">
                {network}
              </span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex flex-col space-y-4">
          {!address ? (
            <div className="flex flex-col space-y-4">
              <p className="text-sm text-zinc-400 leading-relaxed">
                Connect your Stellar wallet to securely manage your account and sign transactions.
              </p>
              <button
                onClick={connect}
                disabled={isConnecting}
                aria-label="Connect Stellar Wallet"
                className="w-full flex items-center justify-center gap-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-[12px] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-zinc-900"
              >
                {isConnecting ? (
                  <span className="animate-pulse">Connecting...</span>
                ) : (
                  <>
                    <Wallet className="w-4 h-4" />
                    Connect Wallet
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="flex flex-col space-y-4">
              <div className="p-4 bg-zinc-800/50 border border-zinc-700/50 rounded-[12px] flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                <div className="flex flex-col w-full">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-zinc-400 font-medium">Connected Address</span>
                    <ExplorerLink address={address} label="Explorer" />
                  </div>
                  <span className="text-sm text-zinc-100 font-mono tracking-tight" aria-label="Wallet Address">
                    {truncateAddress(address)}
                  </span>
                </div>
              </div>

              <div className="flex flex-col space-y-3">
                <label className="text-xs text-zinc-400 font-medium">Network Settings</label>
                <div className="flex bg-zinc-800 rounded-[12px] p-1 border border-zinc-700">
                  <button
                    onClick={() => setNetwork("TESTNET")}
                    className={`flex-1 text-xs py-2 px-3 rounded-[8px] font-medium transition-all duration-200 ${
                      network === "TESTNET"
                        ? "bg-zinc-700 text-zinc-100 shadow-sm"
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                    }`}
                    aria-label="Switch to Testnet"
                  >
                    Testnet
                  </button>
                  <button
                    onClick={() => setNetwork("MAINNET")}
                    className={`flex-1 text-xs py-2 px-3 rounded-[8px] font-medium transition-all duration-200 ${
                      network === "MAINNET"
                        ? "bg-indigo-500/10 text-indigo-400 shadow-sm border border-indigo-500/20"
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                    }`}
                    aria-label="Switch to Mainnet"
                  >
                    Mainnet
                  </button>
                </div>
              </div>

              <button
                onClick={disconnect}
                aria-label="Disconnect Wallet"
                className="w-full flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium py-3 px-4 rounded-[12px] transition-all duration-200 border border-zinc-700 hover:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-600"
              >
                <LogOut className="w-4 h-4" />
                Disconnect
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
