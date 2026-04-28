import { useState, useEffect } from "react";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";

export function useWalletKit() {
  const [address, setAddress] = useState<string>("");
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    // Mark as hydrated to avoid hydration mismatches in SSR
    setIsHydrated(true);

    // Fetch the current address from the wallet
    const fetchAddress = async () => {
      try {
        const { address: walletAddress } = await StellarWalletsKit.getAddress();
        setAddress(walletAddress);
        // Store in localStorage for persistence
        localStorage.setItem("stellar_address", walletAddress);
      } catch (error) {
        // User might not be connected, use localStorage as fallback
        const storedAddress = localStorage.getItem("stellar_address") ?? "";
        setAddress(storedAddress);
      }
    };

    fetchAddress();

    // Listen for storage changes across tabs/windows
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === "stellar_address" && event.newValue) {
        setAddress(event.newValue);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  return {
    kit: StellarWalletsKit,
    address,
    isHydrated,
  };
}
