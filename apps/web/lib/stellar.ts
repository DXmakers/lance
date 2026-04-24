import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { Horizon, StrKey, Transaction } from "@stellar/stellar-sdk";
import { categorizeWalletError } from "./wallet-errors";

let kit: StellarWalletsKit | null = null;

export type StellarNetwork = Networks.TESTNET | Networks.PUBLIC;
export { Networks };

export const APP_STELLAR_NETWORK: StellarNetwork =
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK as StellarNetwork) ?? Networks.TESTNET;

export interface ConnectedWallet {
  address: string;
  walletId: string;
  walletName: string;
  walletIcon: string;
}

export interface WalletMeta {
  id: string;
  name: string;
  icon: string;
}

// --- Wallet ID persistence ---

function readStoredWalletId(): string | null {
  try {
    return localStorage.getItem("selectedWalletId");
  } catch {
    return null;
  }
}

function writeStoredWalletId(id: string): void {
  try {
    localStorage.setItem("selectedWalletId", id);
  } catch {}
}

export function getSelectedWalletId(): string | null {
  return readStoredWalletId();
}

// --- Validation helpers ---

export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address);
}

export function assertValidStellarAddress(address: string): string {
  if (!isValidStellarAddress(address)) {
    throw new Error("Invalid Stellar account address returned by wallet.");
  }
  return address;
}

export function assertValidTransactionXdr(xdr: string): string {
  try {
    new Transaction(xdr, APP_STELLAR_NETWORK);
    return xdr;
  } catch {
    throw new Error("Invalid Stellar transaction XDR.");
  }
}

// --- Kit ---

export function getWalletsKit(): StellarWalletsKit {
  if (typeof window === "undefined") return null as unknown as StellarWalletsKit;

  if (!kit) {
    kit = new StellarWalletsKit({
      network: APP_STELLAR_NETWORK,
      selectedWalletId: readStoredWalletId() ?? "freighter",
      modules: ["freighter", "albedo", "xbull"],
    });
  }
  return kit;
}

// --- Wallet connection ---

export async function connectWallet(): Promise<string> {
  const wallet = await connectWalletWithInfo();
  return wallet.address;
}

export async function connectWalletWithInfo(): Promise<ConnectedWallet> {
  if (process.env.NEXT_PUBLIC_E2E === "true") {
    return {
      address: "GD...CLIENT",
      walletId: "freighter",
      walletName: "Freighter",
      walletIcon: "",
    };
  }
  const walletsKit = getWalletsKit();
  return new Promise<ConnectedWallet>((resolve, reject) => {
    walletsKit.openModal({
      onWalletSelected: async (option) => {
        try {
          walletsKit.setWallet(option.id);
          writeStoredWalletId(option.id);
          walletsKit.closeModal();
          const { address } = await walletsKit.getAddress();
          resolve({
            address: assertValidStellarAddress(address),
            walletId: option.id,
            walletName: option.name,
            walletIcon: option.icon ?? "",
          });
        } catch (err) {
          const walletError = categorizeWalletError(err);
          reject(new Error(walletError.userFriendlyMessage));
        }
      },
      onClosed: () => reject(new Error("Wallet connection cancelled by user.")),
    });
  });
}

export async function getWalletInfo(walletId: string): Promise<WalletMeta | null> {
  try {
    const walletsKit = getWalletsKit();
    const supportedWallets = await walletsKit.getSupportedWallets();
    const match = supportedWallets.find((w) => w.id === walletId);
    if (!match) return null;
    return { id: match.id, name: match.name, icon: match.icon ?? "" };
  } catch {
    return null;
  }
}

export async function disconnectWallet(): Promise<void> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return;
  await getWalletsKit().disconnect();
}

export async function getConnectedWalletAddress(): Promise<string | null> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return "GD...CLIENT";
  try {
    const { address } = await getWalletsKit().getAddress();
    return assertValidStellarAddress(address);
  } catch {
    return null;
  }
}

export async function getWalletNetwork(): Promise<StellarNetwork | null> {
  const walletKit = getWalletsKit() as StellarWalletsKit & {
    getNetwork?: () => Promise<{ network: string }>;
  };

  if (!walletKit.getNetwork) {
    return null;
  }

  try {
    const result = await walletKit.getNetwork();
    const network = result.network;
    if (network === Networks.TESTNET || network === Networks.PUBLIC) {
      return network;
    }
    return null;
  } catch {
    return null;
  }
}

export async function signTransaction(xdr: string): Promise<string> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return xdr;

  const walletsKit = getWalletsKit();
  const validatedXdr = assertValidTransactionXdr(xdr);

  try {
    const { signedTxXdr } = await walletsKit.signTransaction(validatedXdr, {
      networkPassphrase: APP_STELLAR_NETWORK,
    });
    return assertValidTransactionXdr(signedTxXdr);
  } catch (err) {
    const walletError = categorizeWalletError(err);
    throw new Error(walletError.userFriendlyMessage);
  }
}

function getHorizonUrl(network: StellarNetwork): string {
  return network === Networks.PUBLIC
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";
}

export async function getXlmBalance(address: string): Promise<string | null> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return "1000.0000000";

  const validatedAddress = assertValidStellarAddress(address);
  const server = new Horizon.Server(getHorizonUrl(APP_STELLAR_NETWORK));

  try {
    const account = await server.loadAccount(validatedAddress);
    const nativeBalance = account.balances.find(
      (balance): balance is Horizon.HorizonApi.BalanceLineNative =>
        balance.asset_type === "native",
    );
    return nativeBalance?.balance ?? null;
  } catch {
    return null;
  }
}
