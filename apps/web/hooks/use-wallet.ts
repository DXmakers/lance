"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { useWalletStore } from "@/lib/store/use-wallet-store";
import { getWalletsKit, APP_STELLAR_NETWORK } from "@/lib/stellar";
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

  const connect = useCallback(async (id: any) => {
    setStatus("connecting");
    const kit = getWalletsKit();
    
    try {
      kit.setWallet(id);
      const { address: connectedAddress } = await kit.getAddress();
      
      // Verify network compatibility
      const walletNetwork = await kit.getNetwork().catch(() => null);
      if (walletNetwork && walletNetwork.network !== APP_STELLAR_NETWORK) {
        toast.warning(`Network mismatch! App is on ${APP_STELLAR_NETWORK}, but wallet is on ${walletNetwork.network}.`);
      }

      setConnection(connectedAddress, id);
      toast.success("Wallet connected successfully");
      setIsModalOpen(false);
    } catch (err: any) {
      const message = err.message || "Failed to connect wallet";
      setError(message);
      toast.error(message);
      throw err;
    }
  }, [setConnection, setError, setStatus]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    toast.info("Wallet disconnected");
  }, [disconnect]);

  // Auto-connect and Listeners
  useEffect(() => {
    if (isInitialized.current) return;
    
    const kit = getWalletsKit();

    const attemptAutoConnect = async () => {
      if (address && walletId) {
        try {
          kit.setWallet(walletId as any);
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

    // Re-register listeners for account and network changes
    if (kit) {
      kit.onAccountChange((newAddress) => {
        if (newAddress) {
          setConnection(newAddress, walletId || "freighter");
          toast.info("Account switched in wallet");
        } else {
          disconnect();
        }
      });

      kit.onNetworkChange((newNetwork) => {
        if (newNetwork !== APP_STELLAR_NETWORK) {
          toast.warning(`Network mismatch detected: ${newNetwork}`);
        }
      });
    }
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
