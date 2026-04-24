import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WalletState {
  publicKey: string | null;
  walletId: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  
  setConnection: (publicKey: string, walletId: string) => void;
  setConnecting: (isConnecting: boolean) => void;
  setError: (error: string | null) => void;
  disconnect: () => void;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      publicKey: null,
      walletId: null,
      isConnected: false,
      isConnecting: false,
      error: null,

      setConnection: (publicKey, walletId) => 
        set({ publicKey, walletId, isConnected: true, isConnecting: false, error: null }),
      
      setConnecting: (isConnecting) => set({ isConnecting }),
      
      setError: (error) => set({ error, isConnecting: false }),
      
      disconnect: () => 
        set({ publicKey: null, walletId: null, isConnected: false, isConnecting: false, error: null }),
    }),
    {
      name: "lance-wallet-storage",
    }
  )
);
