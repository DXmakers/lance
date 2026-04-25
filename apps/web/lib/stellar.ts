import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { StrKey, Transaction } from "@stellar/stellar-sdk";

let kit: StellarWalletsKit | null = null;

export type StellarNetwork = Networks.TESTNET | Networks.PUBLIC;

export const APP_STELLAR_NETWORK: StellarNetwork =
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK as StellarNetwork) ?? Networks.TESTNET;

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
    // Parse to ensure shape and network passphrase are valid for this app config.
    new Transaction(xdr, APP_STELLAR_NETWORK);
    return xdr;
  } catch {
    throw new Error("Invalid Stellar transaction XDR.");
  }
}

export function getWalletsKit(): StellarWalletsKit {
  if (!kit) {
    kit = new StellarWalletsKit({
      network: APP_STELLAR_NETWORK,
      selectedWalletId: "freighter",
      modules: ["freighter", "albedo", "xbull"],
    });
  }
  return kit;
}

export async function connectWallet(): Promise<string> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return "GD...CLIENT";
  const walletsKit = getWalletsKit();
  return new Promise<string>((resolve, reject) => {
    walletsKit.openModal({
      onWalletSelected: async () => {
        try {
          walletsKit.closeModal();
          const { address } = await walletsKit.getAddress();
          resolve(assertValidStellarAddress(address));
        } catch (err) {
          reject(err);
        }
      },
      onClosed: () => reject(new Error("Wallet connection cancelled by user.")),
    });
  });
}

export async function connectWalletWithInfo(): Promise<{
  address: string;
  walletId: string;
  walletName: string;
  walletIcon: string;
}> {
  const address = await connectWallet();
  const walletId = getSelectedWalletId() || "freighter";
  const info = await getWalletInfo(walletId);

  return {
    address,
    walletId,
    walletName: info?.name || walletId,
    walletIcon: info?.icon || "",
  };
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

export function getSelectedWalletId(): string | null {
  // The kit might store this internally or we can get it from its configuration
  return (getWalletsKit() as unknown as { selectedWalletId?: string }).selectedWalletId || null;
}

export async function getWalletInfo(id: string): Promise<{
  id: string;
  name: string;
  icon: string;
} | null> {
  // In a real app, this would query the kit modules. 
  // For now, we return standard metadata for the common wallets.
  const wallets = [
    { id: "freighter", name: "Freighter", icon: "https://freighter.app/logo.png" },
    { id: "albedo", name: "Albedo", icon: "https://albedo.link/static/logo.svg" },
    { id: "xbull", name: "xBull", icon: "https://xbull.app/logo.png" },
  ];
  return wallets.find(w => w.id === id) || null;
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

  const { signedTxXdr } = await walletsKit.signTransaction(validatedXdr, {
    networkPassphrase: APP_STELLAR_NETWORK,
  });

  return assertValidTransactionXdr(signedTxXdr);
}

/**
 * Signs a raw message/blob using the active wallet.
 * Useful for SIWS (Sign-In With Stellar).
 */
export async function signMessage(message: string): Promise<string> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return "MOCKED_SIGNATURE";

  const walletsKit = getWalletsKit();
  
  // Use signMessage for SIWS (Sign-In With Stellar).
  // Cast to any because the kit types may be slightly behind the implementation for some modules.
  const { signedMessage } = await (walletsKit as unknown as { signMessage: (m: string) => Promise<{ signedMessage: string }> }).signMessage(message);
  
  return signedMessage;
}
