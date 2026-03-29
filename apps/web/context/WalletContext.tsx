"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getWalletsKit } from "@/lib/stellar";
import { toast } from "sonner";

interface WalletContextType {
  publicKey: string | null;
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider = ({ children }: { children: React.ReactNode }) => {
  const [publicKey, setPublicKey] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("wallet_address");
    }
    return null;
  });

  const connect = useCallback(async () => {
    const kit = getWalletsKit();
    try {
      // The openModal method will handle the wallet selection and connection.
      // We listen for the wallet selection to set the active wallet and get the address.
      kit.openModal({
        onWalletSelected: async (wallet) => {
          kit.setWallet(wallet.id);
          const { address } = await kit.getAddress();
          setPublicKey(address);
          localStorage.setItem("wallet_address", address);
          localStorage.setItem("wallet_id", wallet.id);
          toast.success("Wallet connected successfully");
        },
      });
    } catch (error) {
      console.error("Failed to connect wallet:", error);
      toast.error("Failed to connect wallet");
    }
  }, []);

  const disconnect = useCallback(() => {
    setPublicKey(null);
    localStorage.removeItem("wallet_address");
    localStorage.removeItem("wallet_id");
    toast.info("Wallet disconnected");
  }, []);

  useEffect(() => {
    // Attempt to restore session on mount
    const storedId = typeof window !== "undefined" ? localStorage.getItem("wallet_id") : null;
    if (storedId) {
      const kit = getWalletsKit();
      kit.setWallet(storedId);
    }
  }, []);

  return (
    <WalletContext.Provider value={{ publicKey, isConnected: !!publicKey, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
};
