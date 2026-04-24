"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { useWalletStore } from "@/lib/store/use-wallet-store";
import { useAccountChangeListener } from "./use-account-listener";
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
const ACCOUNT_CHECK_INTERVAL = 3000;

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
  const [hasNetworkMismatch, setHasNetworkMismatch] = useState(false);
  const isInitialized = useRef(false);
  const displayNetwork = toDisplayNetwork(network);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setIsModalOpen(true);

    try {
      const connectedAddress = await connectWallet();
      setConnection(connectedAddress, WALLET_KIT_ID);
      toast.success("Wallet connected successfully");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to connect wallet";
      setError(message);
      toast.error(message);
    } finally {
      setIsModalOpen(false);
    }
  }, [setConnection, setError, setStatus]);

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
    setHasNetworkMismatch(false);
    toast.success(`Network switched to ${newNetwork}`);
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

  const handleAccountChange = useCallback((newAddress: string | null) => {
    if (newAddress === null) {
      toast.warning("Wallet account changed. Please reconnect.");
      disconnectStore();
    } else {
      toast.info("Account changed. Session updated.");
      setConnection(newAddress, walletId ?? WALLET_KIT_ID);
    }
  }, [disconnectStore, setConnection, walletId]);

  const handleNetworkMismatch = useCallback((expected: Networks, actual: Networks) => {
    const expectedStr = expected === Networks.PUBLIC ? "MAINNET" : "TESTNET";
    const actualStr = actual === Networks.PUBLIC ? "MAINNET" : "TESTNET";
    setHasNetworkMismatch(true);
    toast.error(
      `Network mismatch detected. App is on ${expectedStr} but wallet is on ${actualStr}.`,
      { duration: 10000 }
    );
  }, []);

  const { isMonitoring } = useAccountChangeListener({
    onAccountChanged: handleAccountChange,
    onNetworkMismatch: handleNetworkMismatch,
    enabled: status === "connected",
  });

  const checkForAccountChanges = useCallback(async () => {
    if (!address || !walletId || status !== "connected") return;

    try {
      const currentAddress = await getConnectedWalletAddress();

      if (currentAddress !== address) {
        if (currentAddress === null) {
          toast.info("Wallet disconnected externally.");
          disconnectStore();
          handleAccountChange(null);
        } else {
          handleAccountChange(currentAddress);
        }
      }
    } catch {
      // Ignore errors during polling
    }
  }, [address, walletId, status, disconnectStore, handleAccountChange]);

  const handleStorageChange = useCallback((event: StorageEvent) => {
    if (event.key === "wallet_address") {
      if (event.newValue === null && address) {
        toast.info("Wallet disconnected in another tab.");
        disconnectStore();
        handleAccountChange(null);
      } else if (event.newValue && event.newValue !== address) {
        handleAccountChange(event.newValue);
      }
    }
  }, [address, disconnectStore, handleAccountChange]);

  const handleVisibilityChange = useCallback(async () => {
    if (document.visibilityState === "visible" && status === "connected") {
      await checkForAccountChanges();
    }
  }, [checkForAccountChanges, status]);

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

    void attemptAutoConnect();
  }, [address, walletId, setConnection, setStatus, disconnectStore]);

  useEffect(() => {
    if (status !== "connected") return;

    const intervalId = setInterval(checkForAccountChanges, ACCOUNT_CHECK_INTERVAL);
    window.addEventListener("storage", handleStorageChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener("storage", handleStorageChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [status, checkForAccountChanges, handleStorageChange, handleVisibilityChange]);

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
    hasNetworkMismatch,
    isAccountMonitoring: isMonitoring,
  };
}
