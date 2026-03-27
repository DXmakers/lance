"use client";

import React from "react";
import { useWallet } from "@/context/WalletContext";

export const ConnectButton: React.FC = () => {
  const { publicKey, isConnected, connect, disconnect } = useWallet();

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  if (isConnected && publicKey) {
    return (
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          {formatAddress(publicKey)}
        </span>
        <button
          onClick={disconnect}
          className="rounded-full bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      className="rounded-full bg-black px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
    >
      Connect Wallet
    </button>
  );
};
