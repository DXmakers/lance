"use client";

import { useCallback, useEffect } from "react";
import { Networks } from "@creit.tech/stellar-wallets-kit";
import {
  connectWallet,
  getConnectedWalletAddress,
  getWalletsKit,
} from "@/lib/stellar";
import { useAuthStore, jwtMemory } from "@/lib/store/use-auth-store";
import { api } from "@/lib/api";

const EXPECTED_NETWORK =
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK as Networks) ?? Networks.TESTNET;

const JWT_SESSION_KEY = "lance_jwt";

export function useWalletAuth() {
  const {
    walletAddress,
    jwt,
    networkMismatch,
    isLoggedIn,
    setWalletAddress,
    setJwt,
    setNetworkMismatch,
    setHydrated,
    logout,
  } = useAuthStore();

  // Rehydrate JWT from sessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem(JWT_SESSION_KEY);
    if (stored) {
      jwtMemory.set(stored);
      setJwt(stored);
    }
    setHydrated(true);
  }, [setJwt, setHydrated]);

  const checkNetwork = useCallback(async () => {
    try {
      const kit = getWalletsKit();
      if (!kit || typeof kit.getNetwork !== "function") return;
      const info = await kit.getNetwork();
      const mismatch = info.network !== EXPECTED_NETWORK;
      setNetworkMismatch(mismatch);
    } catch {
      setNetworkMismatch(false);
    }
  }, [setNetworkMismatch]);

  // Check network on mount
  useEffect(() => {
    void checkNetwork();
  }, [checkNetwork]);

  // Poll for account changes every 3s as StellarWalletsKit v2
  // does not expose an event emitter API
  useEffect(() => {
    const interval = setInterval(async () => {
      const address = await getConnectedWalletAddress();
      if (address && address !== walletAddress) {
        setWalletAddress(address);
        await checkNetwork();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [walletAddress, setWalletAddress, checkNetwork]);

  const connect = useCallback(async () => {
    try {
      const address = await connectWallet();
      setWalletAddress(address);

      await checkNetwork();

      const { token } = await api.auth.getChallenge(address);
      sessionStorage.setItem(JWT_SESSION_KEY, token);
      jwtMemory.set(token);
      setJwt(token);

      return address;
    } catch (err) {
      console.error("Wallet connect failed:", err);
      throw err;
    }
  }, [setWalletAddress, setJwt, checkNetwork]);

  const disconnect = useCallback(() => {
    sessionStorage.removeItem(JWT_SESSION_KEY);
    jwtMemory.clear();
    logout();
  }, [logout]);

  return {
    walletAddress,
    jwt,
    isLoggedIn,
    networkMismatch,
    connect,
    disconnect,
  };
}