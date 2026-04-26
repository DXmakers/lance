"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  APP_STELLAR_NETWORK,
  connectWallet,
  disconnectWallet,
  getConnectedWalletAddress,
  getXlmBalance,
  getWalletNetwork,
  type StellarNetwork,
} from "@/lib/stellar";
import { SIWSService, SIWSResponse } from "@/lib/siws";

const SESSION_STORAGE_KEY = "lance.wallet.session.v1";

interface WalletSessionCache {
  address: string;
  updatedAt: number;
  siwsResponse?: SIWSResponse;
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
    return JSON.parse(value) as WalletSessionCache;
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

  storage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({
      address,
      updatedAt: Date.now(),
    }),
  );
}

export function useWalletSession() {
  const [address, setAddress] = useState<string | null>(null);
  const [walletNetwork, setWalletNetwork] = useState<StellarNetwork | null>(null);
  const [xlmBalance, setXlmBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siwsResponse, setSiwsResponse] = useState<SIWSResponse | null>(null);

  const refreshWalletState = useCallback(async () => {
    try {
      const connected = await getConnectedWalletAddress();
      const network = getWalletNetwork();
      const balance = connected ? await getXlmBalance(connected) : null;

      setAddress(connected);
      setWalletNetwork(network);
      setXlmBalance(balance);
      persistSession(connected);
    } catch {
      setError("Failed to restore wallet session.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const cached = readCachedSession();

    if (cached?.address) {
      setAddress(cached.address);
    }

    void refreshWalletState();
  }, [refreshWalletState]);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    try {
      const connectedAddress = await connectWallet();
      const network = getWalletNetwork();
      const balance = await getXlmBalance(connectedAddress);

      setAddress(connectedAddress);
      setWalletNetwork(network);
      setXlmBalance(balance);

      persistSession(connectedAddress);

      return connectedAddress;
    } catch {
      setError("Wallet connection failed.");
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const authenticate = useCallback(async (walletAddress: string) => {
    setIsAuthenticating(true);

    try {
      const response = await SIWSService.signIn(walletAddress);
      setSiwsResponse(response);
      return response;
    } catch {
      setError("Authentication failed");
      return null;
    } finally {
      setIsAuthenticating(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    disconnectWallet();

    setAddress(null);
    setWalletNetwork(null);
    setXlmBalance(null);
    setSiwsResponse(null);

    persistSession(null);
  }, []);

  const networkMismatch = useMemo(
    () => walletNetwork !== null && walletNetwork !== APP_STELLAR_NETWORK,
    [walletNetwork],
  );

  return {
    address,
    walletNetwork,
    xlmBalance,
    appNetwork: APP_STELLAR_NETWORK,
    isConnected: Boolean(address),
    isAuthenticated: Boolean(siwsResponse),
    isLoading,
    isConnecting,
    isAuthenticating,
    networkMismatch,
    error,
    siwsResponse,
    connect,
    authenticate,
    disconnect,
    refreshWalletState,
  };
}