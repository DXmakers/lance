import { useState, useCallback, useEffect } from "react";
import { Networks } from "@stellar/stellar-sdk";
import { useAuthStore } from "@/lib/store/use-auth-store";
import { api } from "@/lib/api";
import {
  APP_STELLAR_NETWORK,
  connectWallet,
  getWalletNetwork,
  getWalletsKit,
} from "@/lib/stellar";
import { toast } from "sonner";

type WalletDisplayNetwork = "MAINNET" | "TESTNET";

function toDisplayNetwork(network: typeof APP_STELLAR_NETWORK): WalletDisplayNetwork {
  return network === "public" ? "MAINNET" : "TESTNET";
}

export function useWallet() {
  const { login, logout, user, isLoggedIn } = useAuthStore();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [network, setDisplayNetwork] = useState<WalletDisplayNetwork>(
    toDisplayNetwork(APP_STELLAR_NETWORK),
  );
  const address = user?.address;
  const isConnected = isLoggedIn && Boolean(address);
  const status = isConnecting
    ? "connecting"
    : isConnected
      ? "connected"
      : "disconnected";

  const connect = useCallback(async () => {
    setIsConnecting(true);
    try {
      // 1. Get address and network from wallet
      const kit = getWalletsKit();
      const address = await connectWallet();
      const walletNetwork = getWalletNetwork();
      
      const expectedNetwork = APP_STELLAR_NETWORK.toUpperCase();

      if (walletNetwork.toUpperCase() !== expectedNetwork) {
        toast.warning(`Network Mismatch: App is on ${expectedNetwork} but wallet is on ${walletNetwork}`, {
          duration: 10000,
        });
      }

      // 2. Fetch challenge from backend
      const { challenge } = await api.auth.getChallenge(address);

      // 3. Sign challenge
      const signature = await kit.signMessage(challenge);

      // 4. Verify signature on backend
      const { token } = await api.auth.verify(address, signature);

      // 5. Update store
      login(
        {
          address,
          token,
          name: address.slice(0, 4) + "..." + address.slice(-4),
          email: "",
        },
        "client" // Default to client for now, or fetch from profile
      );

      toast.success("Wallet connected successfully");
    } catch (error: unknown) {
      console.error("Wallet connection error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to connect wallet");
    } finally {
      setIsConnecting(false);
      setIsModalOpen(false);
    }
  }, [login]);

  // Poll for account switches (for wallets that don't emit events)
  useEffect(() => {
    if (!isLoggedIn || !address) return;

    const interval = setInterval(async () => {
      try {
        const kit = getWalletsKit();
        const { address: currentAddress } = await kit.getAddress();
        if (currentAddress !== address) {
          logout();
          toast.info("Account switched in wallet. Please reconnect.");
        }
      } catch {
        // Wallet might be locked or disconnected
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isLoggedIn, address, logout]);

  const disconnect = useCallback(() => {
    logout();
    setIsModalOpen(false);
    toast.info("Wallet disconnected");
  }, [logout]);

  const setNetwork = useCallback((newNetwork: WalletDisplayNetwork) => {
    const stellarNetwork =
      newNetwork === "MAINNET" ? Networks.PUBLIC : Networks.TESTNET;
    getWalletsKit().setNetwork(stellarNetwork);
    setDisplayNetwork(newNetwork);
  }, []);

  return {
    connect,
    disconnect,
    isConnecting,
    isLoggedIn,
    address: user?.address,
    status,
    isConnected,
    isModalOpen,
    setIsModalOpen,
    network,
    setNetwork,
  };
}
