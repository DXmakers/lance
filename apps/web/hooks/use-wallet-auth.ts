"use client";

import { useCallback, useEffect } from "react";
import {
  connectWallet,
  getConnectedWalletAddress,
  getWalletsKit,
} from "@/lib/stellar";
import { APP_STELLAR_NETWORK } from "@/lib/stellar-network";
import { useAuthStore, jwtMemory } from "@/lib/store/use-auth-store";
import { api } from "@/lib/api";

const EXPECTED_NETWORK = APP_STELLAR_NETWORK;

export function useWalletAuth() {
  const {
    walletAddress,
    jwt,
    networkMismatch,
    isLoggedIn,
    setWalletAddress,
    setJwt,
    setNetworkMismatch,
    logout,
  } = useAuthStore();

  const checkNetwork = useCallback(async () => {
    try {
      const kit = await getWalletsKit();
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
      sessionStorage.setItem("lance_jwt", token);
      jwtMemory.set(token);
      setJwt(token);

      return address;
    } catch (err) {
      console.error("Wallet connect failed:", err);
      throw err;
    }
  }, [setWalletAddress, setJwt, checkNetwork]);

  const disconnect = useCallback(() => {
    sessionStorage.removeItem("lance_jwt");
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
