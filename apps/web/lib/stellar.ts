import { Horizon, Networks } from "@stellar/stellar-sdk";

export type StellarNetwork = "public" | "testnet";

type WalletModalOptions = {
  onWalletSelected: () => Promise<void> | void;
};

type WalletAddressResult = {
  address: string;
};

export type WalletKit = {
  openModal: (options: WalletModalOptions) => Promise<void>;
  closeModal: () => void;
  getAddress: () => Promise<WalletAddressResult>;
};

export const APP_STELLAR_NETWORK: StellarNetwork =
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet").toUpperCase() === "PUBLIC"
    ? "public"
    : "testnet";

const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ||
  "https://horizon-testnet.stellar.org";

export const horizonServer = new Horizon.Server(HORIZON_URL);

export function isValidStellarAddress(address: string): boolean {
  return /^[G][A-Z2-7]{55}$/.test(address);
}

export function getWalletNetwork(): StellarNetwork {
  return APP_STELLAR_NETWORK;
}

export function disconnectWallet(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem("wallet_address");
    localStorage.removeItem("wallet_type");
    window.dispatchEvent(new Event("storage"));
  }
}

export function getWalletsKit(): WalletKit {
  return {
    openModal: async ({ onWalletSelected }) => {
      await onWalletSelected();
    },

    closeModal: () => {},

    getAddress: async () => {
      const stored =
        typeof window !== "undefined"
          ? localStorage.getItem("wallet_address")
          : null;

      return {
        address:
          stored ||
          "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      };
    },
  };
}

export async function getConnectedWalletAddress(): Promise<string | null> {
  if (typeof window !== "undefined") {
    return localStorage.getItem("wallet_address");
  }

  return null;
}

export async function connectWallet(): Promise<string> {
  const address =
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

  if (!walletKit || typeof walletKit.getNetwork !== "function") {
    return null;
  }

  try {
    const result = await walletKit.getNetwork();
    const network = result.network?.toLowerCase();
    
    if (network === "testnet" || network === Networks.TESTNET.toLowerCase()) {
      return Networks.TESTNET;
    }
    if (network === "public" || network === "mainnet" || network === Networks.PUBLIC.toLowerCase()) {
      return Networks.PUBLIC;
    }
    return null;
  } catch {
    return null;
  }
}

export async function signTransaction(xdr: string): Promise<string> {
  return xdr;
}

export async function signMessage(_message: string): Promise<string> {
  return "mock-signature";
}

export async function getXlmBalance(address: string): Promise<string | null> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return "1000.0000000";

  const validatedAddress = assertValidStellarAddress(address);
  const server = new Horizon.Server(getHorizonUrl(APP_STELLAR_NETWORK));

  try {
    const account = await server.loadAccount(validatedAddress);
    const nativeBalance = account.balances.find(
      (balance: Horizon.HorizonApi.BalanceLine): balance is Horizon.HorizonApi.BalanceLineNative =>
        balance.asset_type === "native",
    );
    return nativeBalance?.balance ?? null;
  } catch {
    return null;
  }
}
export async function getXlmBalance(_address: string): Promise<number> {
  return 0;
}
