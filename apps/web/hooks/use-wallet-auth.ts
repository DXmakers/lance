"use client";

import { useCallback, useEffect } from "react";
import { useState } from "react";
import { buildSiwsMessage, generateNonce } from "@/lib/siws";
import {
  signMessage,
  getConnectedWalletAddress,
  disconnectWallet,
} from "@/lib/stellar";
import { APP_STELLAR_NETWORK } from "@/lib/stellar-network";
import { useAuthStore, jwtMemory } from "@/lib/store/use-auth-store";
import { api } from "@/lib/api";

const EXPECTED_NETWORK = APP_STELLAR_NETWORK;

type UseWalletAuthReturn = {
  login: () => Promise<void>;
  disconnect: () => void;
  loading: boolean;
};

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
export const useWalletAuth = (): UseWalletAuthReturn => {
  const [loading, setLoading] = useState(false);

  const login = async (): Promise<void> => {
    setLoading(true);

    try {
      const address = await getConnectedWalletAddress();

      if (!address) {
        throw new Error("No wallet connected");
      }

      const domain =
        typeof window !== "undefined"
          ? window.location.host
          : "localhost";

      const message = buildSiwsMessage({
        address,
        domain,
        nonce: generateNonce(),
        issuedAt: new Date().toISOString(),
      });

      const signature = await signMessage(message);

      console.log("Message signed:", message);
      console.log("Signature:", signature);
    } catch (error) {
      console.error("Login failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const disconnect = (): void => {
    disconnectWallet();
  };

  return {
    login,
    disconnect,
    loading,
  };
}
};
