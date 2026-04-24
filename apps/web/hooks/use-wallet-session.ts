import { useCallback, useEffect, useMemo, useState, useRef } from "react";
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

export function useWalletSession() {
  const { 
    address: storedAddress, 
    setConnection, 
    disconnect: disconnectStore,
    setNetworkMismatch: setStoreNetworkMismatch,
    networkMismatch: storedNetworkMismatch
  } = useWalletStore();

  const [walletNetwork, setWalletNetwork] = useState<StellarNetwork | null>(null);
  const [xlmBalance, setXlmBalance] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStep, setConnectionStep] = useState<string>("");
  const [siwsResponse, setSiwsResponse] = useState<SIWSResponse | null>(null);

  const refreshWalletState = useCallback(async () => {
    try {
      const [connected, network] = await Promise.all([
        getConnectedWalletAddress(),
        getWalletNetwork(),
      ]);
      
      const balance = connected ? await getXlmBalance(connected) : null;
      
      if (connected) {
        setConnection(connected, "wallet"); // Generic wallet ID for now
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
    }, 5000); // 5s poll
    
    return () => clearInterval(interval);
  }, [refreshWalletState]);

  const connect = useCallback(async (walletId?: string) => {
    setIsConnecting(true);
    setError(null);
    setConnectionStep("Connecting to wallet...");

    try {
      const walletsKit = (await import("@/lib/stellar")).getWalletsKit();
      
      if (walletId) {
        await walletsKit.setWallet(walletId as any);
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

  const authenticate = useCallback(async (walletAddress: string): Promise<SIWSResponse | null> => {
    setIsAuthenticating(true);
    setError(null);
    setConnectionStep("Authenticating with SIWS...");

    try {
      const response = await SIWSService.signIn(walletAddress);
      const isValid = await SIWSService.verify(response);
      
      if (!isValid) throw new Error("Authentication verification failed");
      
      setSiwsResponse(response);
      return response;
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed");
      return null;
    } finally {
      setIsAuthenticating(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await disconnectWallet();
    } catch {
      // Best effort
    }
    disconnectStore();
    setWalletNetwork(null);
    setXlmBalance(null);
    setSiwsResponse(null);
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
