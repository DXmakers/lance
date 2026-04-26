"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { useWalletStore } from "@/lib/store/use-wallet-store";
import {
  connectWallet,
  disconnectWallet,
  getConnectedWalletAddress,
  getWalletsKit,
  signMessage as signStellarMessage,
  signTransaction as signStellarTransaction,
} from "@/lib/stellar";
import { toast } from "sonner";
import { Networks } from "@creit.tech/stellar-wallets-kit";

type WalletDisplayNetwork = "MAINNET" | "TESTNET";

const WALLET_KIT_ID = "stellar-wallets-kit";

function toDisplayNetwork(network: Networks): WalletDisplayNetwork {
  return network === Networks.PUBLIC ? "MAINNET" : "TESTNET";
}

export function useWallet() {
  const { 
    address, 
    walletId, 
    status, 
    network,
    setConnection, 
    setStatus, 
    setError, 
    setNetwork: setStoreNetwork,
    disconnect: disconnectStore,
  } = useWalletStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const isInitialized = useRef(false);
  const displayNetwork = toDisplayNetwork(network);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setIsModalOpen(true);

    try {
      const connectedAddress = await connectWallet();
      setConnection(connectedAddress, walletId ?? WALLET_KIT_ID);
      toast.success("Wallet connected successfully");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to connect wallet";
      setError(message);
      toast.error(message);
    } finally {
      setIsModalOpen(false);
    }
  }, [setConnection, setError, setStatus, walletId]);

  const handleDisconnect = useCallback(() => {
    disconnectWallet();
    disconnectStore();
    toast.info("Wallet disconnected");
  }, [disconnectStore]);

  const setNetwork = useCallback((newNetwork: WalletDisplayNetwork) => {
    const stellarNetwork =
      newNetwork === "MAINNET" ? Networks.PUBLIC : Networks.TESTNET;
    const kit = getWalletsKit();
    kit.setNetwork(stellarNetwork);
    setStoreNetwork(stellarNetwork);
  }, [setStoreNetwork]);

  const signTransaction = useCallback(async (xdr: string) => {
    try {
      return await signStellarTransaction(xdr);
    } catch (error) {
      console.error("Sign error:", error);
      toast.error("Transaction rejected by the wallet extension.");
      return null;
    }
  }, []);

  const signAuthMessage = useCallback(async (message: string) => {
    try {
      return await signStellarMessage(message);
    } catch {
      toast.error("Failed to sign authentication message.");
      return null;
    }
  }, []);

  // Auto-connect
  useEffect(() => {
    if (isInitialized.current) return;

    const attemptAutoConnect = async () => {
      if (address && walletId) {
        try {
          const currentAddress = await getConnectedWalletAddress();

          if (currentAddress === address) {
            setStatus("connected");
          } else if (currentAddress) {
            setConnection(currentAddress, walletId);
          } else {
            disconnectStore();
          }
        } catch (err) {
          console.error("Auto-connect failed:", err);
          disconnectStore();
        }
      }
      isInitialized.current = true;
    };

    attemptAutoConnect();
  }, [address, walletId, setConnection, setStatus, disconnectStore]);

  return {
    address,
    walletId,
    status,
    network: displayNetwork,
    connect,
    disconnect: handleDisconnect,
    setNetwork,
    signTransaction,
    signAuthMessage,
    isConnected: status === "connected",
    isConnecting: status === "connecting",
    isModalOpen,
    setIsModalOpen,
  };
}
