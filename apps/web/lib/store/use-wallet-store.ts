import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { Networks } from "@creit.tech/stellar-wallets-kit";

export type WalletStatus = "disconnected" | "connecting" | "connected" | "error";

interface WalletState {
  address: string | null;
  walletId: string | null;
  status: WalletStatus;
  network: Networks;
  error: string | null;

  setConnection: (address: string, walletId: string) => void;
  setStatus: (status: WalletStatus) => void;
  setError: (error: string | null) => void;
  setNetwork: (network: Networks) => void;
  disconnect: () => void;
}

const storageHelper = {
  encrypt: (str: string) => btoa(str),
  decrypt: (str: string) => atob(str),
};

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      address: null,
      walletId: null,
      status: "disconnected",
      network: (process.env.NEXT_PUBLIC_STELLAR_NETWORK as Networks) ?? Networks.TESTNET,
      error: null,

      setConnection: (address, walletId) =>
        set({ address, walletId, status: "connected", error: null }),

      setStatus: (status) => set({ status }),

      setError: (error) => set({ error, status: error ? "error" : "disconnected" }),

      setNetwork: (network) => set({ network }),

      disconnect: () =>
        set({ address: null, walletId: null, status: "disconnected", error: null }),
    }),
    {
      name: "lance-wallet-session",
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          const value = localStorage.getItem(name);
          return value ? storageHelper.decrypt(value) : null;
        },
        setItem: (name, value) => {
          localStorage.setItem(name, storageHelper.encrypt(value));
        },
        removeItem: (name) => localStorage.removeItem(name),
      })),
      partialize: (state) => ({
        address: state.address,
        walletId: state.walletId,
        network: state.network,
      }),
    }
  )
);
