import { useCallback, useEffect, useState, useMemo } from "react";
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
import { useWalletStore } from "@/lib/store/use-wallet-store";

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
  const {
    address: storedAddress,
    setConnection,
    disconnect: disconnectStore,
    setNetworkMismatch: setStoreNetworkMismatch,
    networkMismatch: storedNetworkMismatch,
  } = useWalletStore();

  const [walletNetwork, setWalletNetwork] = useState<StellarNetwork | null>(null);
  const [xlmBalance, setXlmBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStep, setConnectionStep] = useState("");
  const [siwsResponse, setSiwsResponse] = useState<SIWSResponse | null>(null);

  const refreshWalletState = useCallback(async () => {
    try {
      const [connected, network] = await Promise.all([
        getConnectedWalletAddress(),
        getWalletNetwork(),
      ]);

      const balance = connected ? await getXlmBalance(connected) : null;

      if (connected) {
        setConnection(connected, "wallet");
      } else if (storedAddress) {
        disconnectStore();
      }

      setWalletNetwork(network);
      setXlmBalance(balance);

      const mismatch = network !== null && network !== APP_STELLAR_NETWORK;
      setStoreNetworkMismatch(mismatch);

      setConnectionStep("");
    } catch (refreshError) {
      console.error("Failed to refresh wallet state:", refreshError);
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Failed to restore wallet session.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [setConnection, disconnectStore, setStoreNetworkMismatch, storedAddress]);

  // Initial load and event listeners
  useEffect(() => {
    void refreshWalletState();

    const visibilityListener = () => {
      if (!document.hidden) void refreshWalletState();
    };

    window.addEventListener("focus", visibilityListener);
    document.addEventListener("visibilitychange", visibilityListener);

    return () => {
      window.removeEventListener("focus", visibilityListener);
      document.removeEventListener("visibilitychange", visibilityListener);
    };
  }, [refreshWalletState]);

  // Polling for network/account changes
  useEffect(() => {
    const interval = setInterval(() => {
      void refreshWalletState();
    }, 5000);

    return () => clearInterval(interval);
  }, [refreshWalletState]);

  const connect = useCallback(
    async (walletId?: string) => {
      setIsConnecting(true);
      setError(null);
      setConnectionStep("Connecting to wallet...");

      try {
        const walletsKitModule = await import("@/lib/stellar");
        const walletsKit = walletsKitModule.getWalletsKit();

        if (walletId) {
          const kit = walletsKit as { setWallet?: (id: string) => Promise<void> };
          if (typeof kit.setWallet === "function") {
            await kit.setWallet(walletId);
          } else {
            const { StellarWalletsKit: KitClass } = await import(
              "@creit.tech/stellar-wallets-kit"
            );
            const typedKit = KitClass as { setWallet?: (id: string) => void };
            if (typeof typedKit.setWallet === "function") {
              typedKit.setWallet(walletId);
            }
          }
        }

        const connectedAddress = await connectWallet();
        const network = await getWalletNetwork();
        const balance = await getXlmBalance(connectedAddress);

        setConnection(connectedAddress, walletId ?? "wallet");
        setWalletNetwork(network);
        setXlmBalance(balance);

        const mismatch = network !== null && network !== APP_STELLAR_NETWORK;
        setStoreNetworkMismatch(mismatch);

        persistSession(connectedAddress);
        setConnectionStep("");
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
    },
    [setConnection, setStoreNetworkMismatch],
  );

  const authenticate = useCallback(async (walletAddress: string) => {
    setIsAuthenticating(true);
    setError(null);

    try {
      const response = await SIWSService.signIn(walletAddress);
      const isValid = await SIWSService.verify(response);

      if (!isValid) throw new Error("Authentication verification failed");

      setSiwsResponse(response);
      return response;
    } catch (authError) {
      const message =
        authError instanceof Error ? authError.message : "Authentication failed";
      setError(message);
      return null;
    } finally {
      setIsAuthenticating(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    disconnectWallet();
    disconnectStore();
    setWalletNetwork(null);
    setXlmBalance(null);
    setSiwsResponse(null);
    persistSession(null);
  }, [disconnectStore]);

  const networkMismatch = useMemo(
    () => walletNetwork !== null && walletNetwork !== APP_STELLAR_NETWORK,
    [walletNetwork],
  );

  return {
    address: storedAddress,
    walletNetwork,
    xlmBalance,
    appNetwork: APP_STELLAR_NETWORK,
    isConnected: Boolean(storedAddress),
    isAuthenticated: Boolean(siwsResponse),
    isLoading,
    isConnecting,
    isAuthenticating,
    networkMismatch: storedNetworkMismatch || networkMismatch,
    error,
    connectionStep,
    siwsResponse,
    connect,
    authenticate,
    disconnect,
    refreshWalletState,
  };
}