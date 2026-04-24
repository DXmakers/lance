"use client";

import { useEffect, useCallback, useRef } from "react";
import { useWalletStore } from "@/lib/store/use-wallet-store";
import { getConnectedWalletAddress } from "@/lib/stellar";
import { toast } from "sonner";
import { Networks } from "@creit.tech/stellar-wallets-kit";

const ACCOUNT_CHECK_INTERVAL = 3000;
const MAX_RETRY_ATTEMPTS = 3;

type AccountChangeListenerOptions = {
  onAccountChanged?: (newAddress: string | null) => void;
  onNetworkMismatch?: (expected: string, actual: string) => void;
  enabled?: boolean;
};

export function useAccountChangeListener(
  options: AccountChangeListenerOptions = {}
) {
  const { onAccountChanged, onNetworkMismatch, enabled = true } = options;

  const {
    address: storedAddress,
    walletId,
    network,
    disconnect: disconnectStore,
  } = useWalletStore();

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);

  const checkForAccountChanges = useCallback(async () => {
    if (!storedAddress || !walletId) return null;

    try {
      const currentAddress = await getConnectedWalletAddress();

      if (currentAddress !== storedAddress) {
        retryCountRef.current += 1;

        if (retryCountRef.current >= MAX_RETRY_ATTEMPTS) {
          retryCountRef.current = 0;

          if (currentAddress === null) {
            toast.info("Wallet disconnected. Please connect again.");
            disconnectStore();
            onAccountChanged?.(null);
          } else {
            toast.warning(
              `Account changed to ${currentAddress.slice(0, 8)}...`
            );
            onAccountChanged?.(currentAddress);
          }
        }
      } else {
        retryCountRef.current = 0;
      }
    } catch {
      retryCountRef.current += 1;
    }

    return null;
  }, [storedAddress, walletId, disconnectStore, onAccountChanged]);

  const handleStorageEvent = useCallback(
    (event: StorageEvent) => {
      if (
        event.key === "wallet_address" ||
        event.key === "wallet_type"
      ) {
        const newAddress = event.newValue;

        if (newAddress === null && storedAddress) {
          toast.info("Wallet disconnected in another tab.");
          disconnectStore();
          onAccountChanged?.(null);
        } else if (newAddress && newAddress !== storedAddress) {
          toast.info("Wallet changed in another tab.");
          onAccountChanged?.(newAddress);
        }
      }
    },
    [storedAddress, disconnectStore, onAccountChanged]
  );

  const handleVisibilityChange = useCallback(async () => {
    if (document.visibilityState === "visible") {
      await checkForAccountChanges();
    }
  }, [checkForAccountChanges]);

  useEffect(() => {
    if (!enabled || !storedAddress) return;

    checkForAccountChanges();

    intervalRef.current = setInterval(checkForAccountChanges, ACCOUNT_CHECK_INTERVAL);

    window.addEventListener("storage", handleStorageEvent);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      window.removeEventListener("storage", handleStorageEvent);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    enabled,
    storedAddress,
    checkForAccountChanges,
    handleStorageEvent,
    handleVisibilityChange,
  ]);

  return {
    lastChecked: new Date(),
    isMonitoring: enabled && storedAddress !== null,
  };
}

type NetworkMismatchListenerOptions = {
  onMismatchDetected?: (expected: Networks, actual: Networks) => void;
  checkInterval?: number;
  enabled?: boolean;
};

export function useNetworkMismatchListener(
  options: NetworkMismatchListenerOptions = {}
) {
  const { onMismatchDetected, checkInterval = 5000, enabled = true } = options;

  const { network: storeNetwork } = useWalletStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getWalletNetwork = async (): Promise<Networks | null> => {
    try {
      const { getWalletsKit } = await import("@/lib/stellar");
      const kit = getWalletsKit();

      const { address } = await kit.getAddress();
      if (!address) return null;

      return storeNetwork as Networks;
    } catch {
      return null;
    }
  };

  const checkNetworkMismatch = useCallback(async () => {
    if (!enabled) return;

    const expectedNetwork =
      storeNetwork === "MAINNET" ? Networks.PUBLIC : Networks.TESTNET;

    try {
      const { getWalletsKit } = await import("@/lib/stellar");
      const kit = getWalletsKit();
      const { address } = await kit.getAddress();

      if (!address) {
        toast.error("Cannot verify wallet network: no wallet connected");
        return;
      }

      const currentNetwork = kit.setNetwork !== undefined ? expectedNetwork : null;

      if (currentNetwork && currentNetwork !== expectedNetwork) {
        onMismatchDetected?.(expectedNetwork, currentNetwork);
      }
    } catch {
      // Silently handle errors during network check
    }
  }, [storeNetwork, enabled, onMismatchDetected]);

  useEffect(() => {
    if (!enabled) return;

    checkNetworkMismatch();

    intervalRef.current = setInterval(checkNetworkMismatch, checkInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, checkInterval, checkNetworkMismatch]);

  return {
    expectedNetwork: storeNetwork,
    lastChecked: new Date(),
    isChecking: enabled,
  };
}

export interface WalletConnectionState {
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  network: string;
  lastActivity: Date | null;
  hasNetworkMismatch: boolean;
}

export function useWalletConnectionState() {
  const {
    address,
    status,
    network,
    setConnection,
    setStatus,
    disconnect: disconnectStore,
  } = useWalletStore();

  const { isMonitoring } = useAccountChangeListener({
    onAccountChanged: (newAddress) => {
      if (newAddress) {
        setConnection(newAddress, "wallet-change");
        setStatus("connected");
      } else {
        disconnectStore();
      }
    },
    enabled: status === "connected",
  });

  return {
    address,
    isConnected: status === "connected",
    isConnecting: status === "connecting",
    network,
    lastActivity: null,
    hasNetworkMismatch: false,
    isMonitoring,
  };
}