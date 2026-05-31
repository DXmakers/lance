"use client";

import { ExternalLink } from "lucide-react";
import { useWallet } from "@/hooks/use-wallet";

interface ExplorerLinkProps {
  address?: string;
  txHash?: string;
  label?: string;
  className?: string;
}

export function ExplorerLink({ address, txHash, label, className = "" }: ExplorerLinkProps) {
  const { network } = useWallet();

  const baseUrl = network === "MAINNET"
    ? "https://stellar.expert/explorer/public"
    : "https://stellar.expert/explorer/testnet";

  const url = txHash
    ? `${baseUrl}/tx/${txHash}`
    : `${baseUrl}/account/${address}`;

  if (!address && !txHash) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-zinc-900 rounded-md px-1 -mx-1 ${className}`}
      aria-label={label || `View on Stellar Explorer`}
    >
      {label || "View on Explorer"}
      <ExternalLink className="w-3 h-3" />
    </a>
  );
}
