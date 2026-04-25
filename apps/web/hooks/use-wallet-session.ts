"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  APP_STELLAR_NETWORK,
  connectWallet,
  disconnectWallet,
  getConnectedWalletAddress,
  getWalletNetwork,
  type StellarNetwork,
} from "@/lib/stellar";

const SESSION_STORAGE_KEY = "lance.wallet.session.v1";

interface WalletSessionCache {
  address: string;
  updatedAt: number;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function readCachedSession(): WalletSessionCache | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const value = storage.getItem(SESSION_STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as WalletSessionCache;
    return parsed.address ? parsed : null;
  } catch {
    return null;
  }
}

function persistSession(address: string | null): void {
  const storage = getStorage();
  if (!storage) return;

  if (!address) {
    storage.removeItem(SESSION_STORAGE_KEY);
    return;
  }

  const payload: WalletSessionCache = { address, updatedAt: Date.now() };
  storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
}

export function useWalletSession() {
  const [address, setAddress] = useState<string | null>(() => readCachedSession()?.address || null);
  const [walletNetwork, setWalletNetwork] = useState<StellarNetwork | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siwsResponse, setSiwsResponse] = useState<SIWSResponse | null>(null);

  const refreshWalletState = useCallback(async () => {
    try {
      const [connected, network] = await Promise.all([
        getConnectedWalletAddress(),
        getWalletNetwork(),
      ]);
      setAddress(connected);
      setWalletNetwork(network);
      persistSession(connected);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Failed to restore wallet session.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void refreshWalletState();
    }, 0);

    const visibilityListener = () => {
      if (!document.hidden) {
        void refreshWalletState();
      }
    };

    document.addEventListener("visibilitychange", visibilityListener);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("visibilitychange", visibilityListener);
    };
  }, [refreshWalletState]);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    try {
      const connectedAddress = await connectWallet();
      const network = await getWalletNetwork();
      setAddress(connectedAddress);
      setWalletNetwork(network);
      persistSession(connectedAddress);
      return connectedAddress;
    } catch (connectError) {
      const message =
        connectError instanceof Error
          ? connectError.message
          : "Wallet connection failed.";
      setError(message);
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setError(null);

    try {
      await disconnectWallet();
    } catch {
      // disconnect should be best-effort so local session still clears.
    }

    setAddress(null);
    setWalletNetwork(null);
    persistSession(null);
  }, []);

  const networkMismatch = useMemo(
    () => walletNetwork !== null && walletNetwork !== APP_STELLAR_NETWORK,
    [walletNetwork],
  );

  return {
    address,
    walletNetwork,
    appNetwork: APP_STELLAR_NETWORK,
    isConnected: Boolean(address),
    isLoading,
    isConnecting,
    networkMismatch,
    error,
    siwsResponse,
    connect,
    disconnect,
    refreshWalletState,
  };
}
