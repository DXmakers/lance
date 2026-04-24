"use client";

import { useEffect, useCallback, useRef } from "react";
import { useWalletStore } from "@/lib/store/use-wallet-store";
import { getWalletsKit, registerWalletListeners } from "@/lib/stellar";
import { WalletId, Networks } from "@creit.tech/stellar-wallets-kit";
import { toast } from "sonner";

export function useWallet() {
  const { 
    address, 
    walletId, 
    status, 
    network: appNetwork,
    setConnection, 
    setStatus, 
    setError, 
    disconnect,
    setNetwork
  } = useWalletStore();

  const isInitialized = useRef(false);

  const connect = useCallback(async (id: WalletId) => {
    setStatus("connecting");
    const kit = getWalletsKit();
    
    try {
      kit.setWallet(id);
      const { address: connectedAddress } = await kit.getAddress();
      
      // Verify network
      const walletNetwork = await kit.getNetwork();
      if (walletNetwork !== appNetwork) {
        toast.warning(`Network mismatch! Your wallet is on ${walletNetwork}, but the app is on ${appNetwork}.`);
      }

      setConnection(connectedAddress, id);
      toast.success("Wallet connected successfully");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to connect wallet";
      setError(message);
      toast.error(message);
      throw err;
    }
  }, [appNetwork, setConnection, setError, setStatus]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    toast.info("Wallet disconnected");
  }, [disconnect]);

  // Auto-connect logic
  useEffect(() => {
    if (isInitialized.current) return;
    
    const attemptAutoConnect = async () => {
      if (address && walletId) {
        try {
          const kit = getWalletsKit();
          kit.setWallet(walletId as WalletId);
          const { address: currentAddress } = await kit.getAddress();
          
          if (currentAddress === address) {
            setStatus("connected");
          } else {
            // Account changed while we were away
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

    // Register listeners
    registerWalletListeners(
      (newAddress) => {
        if (newAddress) {
          setConnection(newAddress, walletId as string);
          toast.info("Account switched in wallet");
        } else {
          disconnect();
        }
      },
      (newNetwork) => {
        if (newNetwork !== appNetwork) {
          toast.warning(`Network switched to ${newNetwork}. Expected ${appNetwork}.`);
        }
      }
    );
  }, [address, walletId, appNetwork, setConnection, setStatus, disconnect]);

  return {
    address,
    walletId,
    status,
    connect,
    disconnect: handleDisconnect,
    isConnected: status === "connected",
    isConnecting: status === "connecting",
  };
}
