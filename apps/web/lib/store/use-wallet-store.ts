import { create } from "zustand";
import { persist } from "zustand/middleware";

// Matching the Networks enum from the kit to avoid circular dependencies or import issues
export enum WalletNetworkPassphrase {
  PUBLIC = "Public Global Stellar Network ; September 2015",
  TESTNET = "Test SDF Network ; September 2015",
}

interface WalletState {
  publicKey: string | null;
  address: string | null;
  walletId: string | null;
  status: "connected" | "disconnected" | "connecting" | "error";
  network: string;
  error: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  
  setConnection: (publicKey: string, walletId: string) => void;
  setStatus: (status: "connected" | "disconnected" | "connecting" | "error") => void;
  setNetwork: (network: string) => void;
  setConnecting: (isConnecting: boolean) => void;
  setError: (error: string | null) => void;
  disconnect: () => void;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      publicKey: null,
      address: null,
      walletId: null,
      status: "disconnected",
      network: WalletNetworkPassphrase.TESTNET,
      error: null,
      isConnected: false,
      isConnecting: false,

      setConnection: (publicKey, walletId) => 
        set({ 
          publicKey, 
          address: publicKey, 
          walletId, 
          status: "connected", 
          isConnected: true, 
          isConnecting: false, 
          error: null 
        }),
      
      setStatus: (status) => set({ 
        status, 
        isConnected: status === "connected", 
        isConnecting: status === "connecting" 
      }),
      
      setNetwork: (network) => set({ network }),
      
      setConnecting: (isConnecting) => set({ 
        isConnecting, 
        status: isConnecting ? "connecting" : (get().isConnected ? "connected" : "disconnected") 
      }),
      
      setError: (error) => set({ 
        error, 
        status: "error", 
        isConnecting: false 
      }),
      
      disconnect: () => 
        set({ 
          publicKey: null, 
          address: null, 
          walletId: null, 
          status: "disconnected", 
          isConnected: false, 
          isConnecting: false, 
          error: null 
        }),
    }),
    {
      name: "lance-wallet-storage",
    }
  )
);
