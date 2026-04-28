import { useState, useEffect, useMemo } from "react";
import {
  StellarWalletsKit,
  WalletNetwork,
  FREIGHTER_ID,
} from "@creit.tech/stellar-wallets-kit";

let _kit: StellarWalletsKit | null = null;

function getKit(): StellarWalletsKit {
  if (!_kit) {
    _kit = new StellarWalletsKit({
      network: WalletNetwork.TESTNET,
      selectedWalletId: FREIGHTER_ID,
    });
  }
  return _kit;
}

export function useWalletKit() {
  const kit = useMemo(() => getKit(), []);
  const [address, setAddress] = useState<string>("");
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    // Mark as hydrated to avoid hydration mismatches in SSR
    setIsHydrated(true);

    // Read address from localStorage after hydration
    const storedAddress = localStorage.getItem("stellar_address") ?? "";
    setAddress(storedAddress);

    // Listen for storage changes across tabs/windows
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === "stellar_address" && event.newValue) {
        setAddress(event.newValue);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  return { kit, address, isHydrated };
}
