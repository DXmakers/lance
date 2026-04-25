"use client";

/**
 * CopyAddressButton - Professional address display with copy functionality
 * 
 * Features:
 * - Truncated address display (0x1234...5678)
 * - One-click copy to clipboard
 * - Visual feedback on copy
 * - Monospace font for technical data
 */

import { useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";

export interface CopyAddressButtonProps {
  address: string;
  truncateLength?: number;
  showFullOnHover?: boolean;
  className?: string;
}

export function CopyAddressButton({
  address,
  truncateLength = 8,
  showFullOnHover = false,
  className = "",
}: CopyAddressButtonProps) {
  const [copied, setCopied] = useState(false);

  const truncateAddress = (addr: string) => {
    if (addr.length <= truncateLength * 2) return addr;
    return `${addr.slice(0, truncateLength)}...${addr.slice(-truncateLength)}`;
  };

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy address:", err);
    }
  }, [address]);

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <span
        className="text-address group relative"
        title={showFullOnHover ? address : undefined}
      >
        {truncateAddress(address)}
        {showFullOnHover && (
          <span className="absolute left-0 top-full mt-1 hidden group-hover:block z-10 bg-zinc-800 text-zinc-100 text-xs px-3 py-2 rounded-lg border border-zinc-700 whitespace-nowrap shadow-lg">
            {address}
          </span>
        )}
      </span>
      <button
        onClick={copyToClipboard}
        className="copy-button"
        aria-label="Copy address"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
