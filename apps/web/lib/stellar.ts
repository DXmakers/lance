import { Networks, StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";

declare global {
  interface Window {
    __LANCE_E2E_WALLET__?: WalletAdapter;
    freighterApi?: {
      getPublicKey?: () => Promise<string>;
      signTransaction?: (
        xdr: string,
      ) => Promise<{ signedTxXdr?: string } | string>;
      isConnected?: () => Promise<boolean>;
    };
  }
}

export interface WalletAdapter {
  connect(): Promise<string>;
  signTransaction(xdr: string): Promise<string>;
  disconnect?(): Promise<void>;
  getAddress?(): Promise<string | null>;
}

class BrowserFreighterAdapter implements WalletAdapter {
  async connect(): Promise<string> {
    const api = window.freighterApi;
    if (!api?.getPublicKey) {
      throw new Error("Freighter-compatible wallet is not available in this browser.");
    }

    return api.getPublicKey();
  }

  async getAddress(): Promise<string | null> {
    const api = window.freighterApi;
    if (!api?.getPublicKey) {
      return null;
    }

    try {
      return await api.getPublicKey();
    } catch {
      return null;
    }
  }

  async signTransaction(xdr: string): Promise<string> {
    const api = window.freighterApi;
    if (!api?.signTransaction) {
      throw new Error("Wallet signing API is unavailable.");
    }

    const result = await api.signTransaction(xdr);
    if (typeof result === "string") {
      return result;
    }

    if (result?.signedTxXdr) {
      return result.signedTxXdr;
    }

    throw new Error("Wallet did not return a signed transaction.");
  }
}

class StellarWalletKitAdapter implements WalletAdapter {
  private readonly kit: StellarWalletsKit;

  constructor() {
    this.kit = new StellarWalletsKit({
      network:
        (process.env.NEXT_PUBLIC_STELLAR_NETWORK as Networks) ??
        Networks.TESTNET,
      selectedWalletId: "freighter",
    });
  }

  async connect(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.kit.openModal({
        onWalletSelected: async () => {
          try {
            this.kit.closeModal();
            const { address } = await this.kit.getAddress();
            resolve(address);
          } catch (error) {
            reject(error);
          }
        },
      });
    });
  }

  async getAddress(): Promise<string | null> {
    try {
      const { address } = await this.kit.getAddress();
      return address ?? null;
    } catch {
      return null;
    }
  }

  async signTransaction(xdr: string): Promise<string> {
    const networkPassphrase =
      (process.env.NEXT_PUBLIC_STELLAR_NETWORK as Networks) ?? Networks.TESTNET;
    const { signedTxXdr } = await this.kit.signTransaction(xdr, {
      networkPassphrase,
    });
    return signedTxXdr;
  }

  async disconnect(): Promise<void> {
    await this.kit.disconnect();
  }
}

let adapter: WalletAdapter | null = null;

function getWindowWallet(): WalletAdapter | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.__LANCE_E2E_WALLET__;
}

export function getWalletAdapter(): WalletAdapter {
  const injected = getWindowWallet();
  if (injected) {
    return injected;
  }

  if (!adapter) {
    adapter = typeof window !== "undefined" && window.freighterApi
      ? new BrowserFreighterAdapter()
      : new StellarWalletKitAdapter();
  }

  return adapter;
}

export async function connectWallet(): Promise<string> {
  return getWalletAdapter().connect();
}

export async function getConnectedWalletAddress(): Promise<string | null> {
  const currentAdapter = getWalletAdapter();
  if (currentAdapter.getAddress) {
    return currentAdapter.getAddress();
  }

  return null;
}

export async function signTransaction(xdr: string): Promise<string> {
  return getWalletAdapter().signTransaction(xdr);
}
