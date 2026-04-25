"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { isValidStellarAddress } from "@/lib/stellar";

interface CopyAddressButtonProps {
  address: string;
  className?: string;
}

function shorten(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function CopyAddressButton({ address, className }: CopyAddressButtonProps) {
  const [copied, setCopied] = useState(false);
  const valid = useMemo(() => isValidStellarAddress(address), [address]);

  const copy = async () => {
    if (!valid) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  if (!valid) return null;

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={`Copy wallet address ${address}`}
      className={
        className ??
        "inline-flex items-center gap-1 rounded-xl border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition-opacity duration-200 hover:opacity-80"
      }
    >
      <span>{shorten(address)}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 text-indigo-300" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-zinc-400" />
      )}
    </button>
  );
}
