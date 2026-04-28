"use client";

import { useState } from "react";
import { X, Wallet, Shield, CheckCircle, AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface WalletConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (walletId: string) => void;
  isConnecting?: boolean;
  error?: string | null;
}

const SUPPORTED_WALLETS = [
  {
    id: "freighter",
    name: "Freighter",
    description: "Popular browser wallet for Stellar",
    url: "https://freighter.app",
    icon: "🚀",
    recommended: true
  },
  {
    id: "albedo",
    name: "Albedo",
    description: "Secure web-based wallet",
    url: "https://albedo.link",
    icon: "🌟",
    recommended: false
  },
  {
    id: "xbull",
    name: "xBull",
    description: "Advanced wallet for power users",
    url: "https://xbull.app",
    icon: "🐂",
    recommended: false
  }
];

/**
 * Wallet Connection Modal
 * 
 * Sophisticated, minimalist UI for wallet selection
 * Follows Zinc-900/Indigo-500 design system
 * WCAG 2.1 AA compliant with proper ARIA labels
 */
export function WalletConnectionModal({ 
  isOpen, 
  onClose, 
  onConnect, 
  isConnecting = false,
  error = null
}: WalletConnectionModalProps) {
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleWalletSelect = (walletId: string) => {
    setSelectedWallet(walletId);
    onConnect(walletId);
  };

  const handleWalletInstall = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-modal-title"
      aria-describedby="wallet-modal-description"
    >
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-zinc-900/80 backdrop-blur-sm transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-md rounded-[12px] bg-zinc-900 border border-zinc-700/50 shadow-2xl shadow-zinc-900/50 transition-all duration-200 transform">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-zinc-700/50">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-[8px] bg-indigo-600/20">
              <Wallet className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 id="wallet-modal-title" className="text-lg font-semibold text-white">
                Connect Wallet
              </h2>
              <p id="wallet-modal-description" className="text-sm text-zinc-400">
                Choose your Stellar wallet
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0 text-zinc-500 hover:text-zinc-400 hover:bg-zinc-800"
            aria-label="Close wallet selection"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Security Notice */}
          <div className="flex items-start gap-3 p-3 rounded-[8px] bg-indigo-500/5 border border-indigo-500/20">
            <Shield className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-medium text-indigo-300 mb-1">
                Secure Connection
              </p>
              <p className="text-xs text-indigo-400/80 leading-relaxed">
                Your wallet will be securely connected. We never have access to your private keys or funds.
              </p>
            </div>
          </div>

          {/* Wallet Options */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
              Available Wallets
            </p>
            
            {SUPPORTED_WALLETS.map((wallet) => (
              <div
                key={wallet.id}
                className={cn(
                  "relative rounded-[8px] border transition-all duration-200",
                  selectedWallet === wallet.id && isConnecting
                    ? "border-indigo-500/50 bg-indigo-500/5"
                    : "border-zinc-700/50 bg-zinc-800/50 hover:border-zinc-600 hover:bg-zinc-800"
                )}
              >
                <button
                  onClick={() => handleWalletSelect(wallet.id)}
                  disabled={isConnecting}
                  className="w-full p-3 flex items-center gap-3 text-left disabled:opacity-60 disabled:cursor-not-allowed"
                  aria-label={`Connect with ${wallet.name}`}
                  aria-describedby={`wallet-${wallet.id}-description`}
                >
                  <div className="flex items-center justify-center w-10 h-10 rounded-[6px] bg-zinc-700/50 text-lg">
                    {wallet.icon}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-white truncate">
                        {wallet.name}
                      </p>
                      {wallet.recommended && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-[4px] bg-indigo-600/20 text-[10px] font-medium text-indigo-400">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p 
                      id={`wallet-${wallet.id}-description`}
                      className="text-xs text-zinc-400 truncate"
                    >
                      {wallet.description}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedWallet === wallet.id && isConnecting ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs text-indigo-400">Connecting...</span>
                      </div>
                    ) : selectedWallet === wallet.id && !isConnecting ? (
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    ) : (
                      <ExternalLink 
                        className="w-4 h-4 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleWalletInstall(wallet.url);
                        }}
                      />
                    )}
                  </div>
                </button>
              </div>
            ))}
          </div>

          {/* Error Display */}
          {error && (
            <div className="flex items-start gap-3 p-3 rounded-[8px] bg-red-500/10 border border-red-500/30">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-medium text-red-400 mb-1">
                  Connection Failed
                </p>
                <p className="text-xs text-red-400/80 leading-relaxed">
                  {error}
                </p>
              </div>
            </div>
          )}

          {/* Help Section */}
          <div className="pt-4 border-t border-zinc-700/50">
            <p className="text-xs text-zinc-500 mb-2">
              Don&apos;t have a wallet yet?
            </p>
            <div className="flex flex-wrap gap-2">
              {SUPPORTED_WALLETS.map((wallet) => (
                <Button
                  key={`install-${wallet.id}`}
                  variant="outline"
                  size="sm"
                  onClick={() => handleWalletInstall(wallet.url)}
                  className="rounded-[6px] border-zinc-700/60 bg-zinc-800/50 text-xs text-zinc-300 hover:border-indigo-500/50 hover:bg-zinc-800 hover:text-white"
                >
                  <ExternalLink className="w-3 h-3 mr-1" />
                  Install {wallet.name}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
