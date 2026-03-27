import { Networks, StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";

declare global {
  interface Window {
    __LANCE_E2E_WALLET__?: WalletAdapter;
  }
}

export interface WalletAdapter {
  connect(): Promise<string>;
  signTransaction(xdr: string): Promise<string>;
  disconnect?(): Promise<void>;
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
    this.kit.openModal({ modalTitle: "Connect wallet" });
    const { address } = await this.kit.getAddress();
    return address;
  }

  async signTransaction(xdr: string): Promise<string> {
    const { signedTxXdr } = await this.kit.signTransaction(xdr, {
      networkPassphrase:
        (process.env.NEXT_PUBLIC_STELLAR_NETWORK as Networks) ??
        Networks.TESTNET,
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
    adapter = new StellarWalletKitAdapter();
  }

  return adapter;
}

export async function connectWallet(): Promise<string> {
  return getWalletAdapter().connect();
}

export async function signTransaction(xdr: string): Promise<string> {
  return getWalletAdapter().signTransaction(xdr);
}
