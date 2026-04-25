import { useCallback, useEffect, useState } from "react";
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
  const { 
    address: storedAddress, 
    setConnection, 
    disconnect: disconnectStore,
    setNetworkMismatch: setStoreNetworkMismatch,
    networkMismatch: storedNetworkMismatch
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
      setError(refreshError instanceof Error ? refreshError.message : "Failed to restore wallet session.");
    } finally {
      setIsLoading(false);
    }
  }, [setConnection, disconnectStore, setStoreNetworkMismatch, storedAddress]);

  useEffect(() => {
    void refreshWalletState();
  }, [refreshWalletState]);

  useEffect(() => {
    const interval = setInterval(() => {
      void refreshWalletState();
    }, 5000);
    
    return () => clearInterval(interval);
  }, [refreshWalletState]);

  const connect = useCallback(async (walletId?: string) => {
    setIsConnecting(true);
    setError(null);
    setConnectionStep("Connecting to wallet...");

    try {
      const walletsKit = (await import("@/lib/stellar")).getWalletsKit();
      
      if (walletId) {
        type WalletsKit = typeof walletsKit & { setWallet?: (walletId: string) => Promise<void> };
        const kit = walletsKit as WalletsKit;
        if (typeof kit.setWallet === 'function') {
          await kit.setWallet(walletId);
        } else {
          const { StellarWalletsKit: KitClass } = await import("@creit.tech/stellar-wallets-kit");
          type KitClassType = typeof KitClass & { setWallet?: (walletId: string) => void };
          const typedKitClass = KitClass as KitClassType;
          if (typeof typedKitClass.setWallet === 'function') {
            typedKitClass.setWallet(walletId);
          }
        }
      }

      const connectedAddress = await connectWallet();
      const network = await getWalletNetwork();
      const balance = await getXlmBalance(connectedAddress);
      
      setConnection(connectedAddress, "wallet");
      setWalletNetwork(network);
      setXlmBalance(balance);
      
      const mismatch = network !== null && network !== APP_STELLAR_NETWORK;
      setStoreNetworkMismatch(mismatch);
      
      setConnectionStep("");
      return connectedAddress;
    } catch (connectError) {
      const message = connectError instanceof Error ? connectError.message : "Wallet connection failed.";
      setError(message);
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, [setConnection, setStoreNetworkMismatch]);

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
    disconnectStore();
    setWalletNetwork(null);
    setXlmBalance(null);
    setSiwsResponse(null);
    persistSession(null);
  }, [disconnectStore]);

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
    networkMismatch: storedNetworkMismatch,
    error,
    connectionStep,
    siwsResponse,
    connect,
    authenticate,
    disconnect,
    refreshWalletState,
  };
}