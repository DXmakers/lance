"use client";
import { useEffect, useCallback, useRef, useState } from "react";
import { useWalletStore } from "@/lib/store/use-wallet-store";
import { getWalletsKit } from "@/lib/stellar";
import { toast } from "sonner";

export function useWallet() {
  const { 
    address, 
    walletId, 
    status, 
    setConnection, 
    setStatus, 
    setError, 
    disconnect,
  } = useWalletStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const isInitialized = useRef(false);

  const connect = useCallback(async (connectedAddress: string) => {
    setStatus("connecting");
    try {
      setConnection(connectedAddress, connectedAddress);
      toast.success("Wallet connected successfully");
      setIsModalOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to connect wallet";
      setError(message);
      toast.error(message);
      throw err;
    }
  }, [setConnection, setError, setStatus]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    toast.info("Wallet disconnected");
  }, [disconnect]);

  // Auto-connect
  useEffect(() => {
    if (isInitialized.current) return;

    const attemptAutoConnect = async () => {
      if (address && walletId) {
        try {
          const kit = getWalletsKit();
          const { address: currentAddress } = await kit.getAddress();

          if (currentAddress === address) {
            setStatus("connected");
          } else {
            setConnection(currentAddress, walletId);
          }
        } catch (err) {
          console.error("Auto-connect failed:", err);
          disconnect();
        }
      }
      isInitialized.current = true;
    };

    attemptAutoConnect();
  }, [address, walletId, setConnection, setStatus, disconnect]);

  return {
    address,
    walletId,
    status,
    connect,
    disconnect: handleDisconnect,
    isConnected: status === "connected",
    isConnecting: status === "connecting",
    isModalOpen,
    setIsModalOpen,
  };
}
