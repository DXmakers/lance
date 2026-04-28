"use client";

import { X, ExternalLink, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface WalletOption {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
}

const WALLET_OPTIONS: WalletOption[] = [
  {
    id: "freighter",
    name: "Freighter",
    description: "Official Stellar wallet extension",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2 17L12 22L22 17" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2 12L12 17L22 12" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: "albedo",
    name: "Albedo",
    description: "Secure web-based wallet service",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="#6366f1" strokeWidth="2"/>
        <path d="M12 8V16M8 12H16" stroke="#6366f1" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: "xbull",
    name: "xBull",
    description: "Powerful multi-feature wallet",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 2L2 7L7 12" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M17 22L22 17L17 12" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M2 17L7 22" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M22 7L17 2" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
];

interface WalletSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
}

export function WalletSelectionModal({ isOpen, onClose, onSelect }: WalletSelectionModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Defer setMounted to avoid synchronous setState in effect
    const timer = setTimeout(() => setMounted(true), 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    if (isOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    } else {
      document.body.style.overflow = "unset";
    }

    return () => {
      clearTimeout(timer);
      document.body.style.overflow = "unset";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!mounted || !isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md transition-opacity duration-200"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.7)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className={cn(
          "relative w-full max-w-[400px] overflow-hidden rounded-[12px] bg-[#18181b] border border-white/5 shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <h2 id="modal-title" className="text-lg font-semibold text-white">Connect Wallet</h2>
          <button 
            onClick={onClose}
            className="rounded-full p-1 text-zinc-500 hover:bg-white/5 hover:text-white transition-colors"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <div className="grid gap-2">
            {WALLET_OPTIONS.map((wallet) => (
              <button
                key={wallet.id}
                onClick={() => onSelect(wallet.id)}
                className="group flex items-center gap-4 rounded-[12px] border border-transparent bg-[#27272a]/50 p-4 text-left transition-all hover:border-indigo-500/30 hover:bg-[#27272a] active:scale-[0.98]"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500/10 transition-colors group-hover:bg-indigo-500/20">
                  {wallet.icon}
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-white">{wallet.name}</h3>
                  <p className="text-xs text-zinc-500">{wallet.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-[#09090b]/50 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-indigo-400" />
              <span className="text-[11px] font-medium text-zinc-400">Secure connection verified</span>
            </div>
            <a 
              href="https://stellar.org/wallets" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-indigo-400 transition-colors"
            >
              Learn more <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}