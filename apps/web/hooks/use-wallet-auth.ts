import { useState } from "react";
import { buildSiwsMessage, generateNonce } from "@/lib/siws";
import {
  signMessage,
  getConnectedWalletAddress,
  disconnectWallet,
} from "@/lib/stellar";

type UseWalletAuthReturn = {
  login: () => Promise<void>;
  disconnect: () => void;
  loading: boolean;
};

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
};