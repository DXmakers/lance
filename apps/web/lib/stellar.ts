import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { Horizon, StrKey, Transaction } from "@stellar/stellar-sdk";
import { APP_STELLAR_NETWORK, STELLAR_NETWORKS, type StellarNetwork } from "./stellar-network";
import { categorizeWalletError } from "./wallet-errors";

let kitPromise: Promise<StellarWalletsKit | null> | null = null;

export { APP_STELLAR_NETWORK, STELLAR_NETWORKS, type StellarNetwork };
export const Networks = STELLAR_NETWORKS;

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

export async function getWalletsKit(): Promise<StellarWalletsKit | null> {
  if (typeof window === "undefined") {
    return null;
  }

  if (!kitPromise) {
    kitPromise = import("@creit.tech/stellar-wallets-kit").then(
      ({ StellarWalletsKit }) =>
        new StellarWalletsKit({
          network:
            APP_STELLAR_NETWORK as import("@creit.tech/stellar-wallets-kit").Networks,
          selectedWalletId: "freighter",
          modules: ["freighter", "albedo", "xbull"],
        }),
    );
  }

  return kitPromise;
}

export async function connectWallet(): Promise<string> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return "GD...CLIENT";
  const walletsKit = await getWalletsKit();
  if (!walletsKit) {
    throw new Error("Wallet connection is only available in the browser.");
  }

  return new Promise<string>((resolve, reject) => {
    walletsKit.openModal({
      onWalletSelected: async () => {
        try {
          walletsKit.closeModal();
          const { address } = await walletsKit.getAddress();
          resolve(assertValidStellarAddress(address));
        } catch (err) {
          const walletError = categorizeWalletError(err);
          reject(new Error(walletError.userFriendlyMessage));
        }
      },
      onClosed: () => reject(new Error("Wallet connection cancelled by user.")),
    });
  });
}

export async function disconnectWallet(): Promise<void> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return;
  const walletsKit = await getWalletsKit();
  await walletsKit?.disconnect();
}

export async function getConnectedWalletAddress(): Promise<string | null> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return "GD...CLIENT";
  try {
    const walletsKit = await getWalletsKit();
    if (!walletsKit) {
      return null;
    }

    const { address } = await walletsKit.getAddress();
    return assertValidStellarAddress(address);
  } catch {
    return null;
  }
}

export async function getWalletNetwork(): Promise<StellarNetwork | null> {
  const walletKit = (await getWalletsKit()) as (StellarWalletsKit & {
    getNetwork?: () => Promise<{ network: string }>;
  }) | null;

  if (!walletKit?.getNetwork) {
    return null;
  }

  try {
    const result = await walletKit.getNetwork();
    const network = result.network;
    if (
      network === STELLAR_NETWORKS.TESTNET ||
      network === STELLAR_NETWORKS.PUBLIC
    ) {
      return network;
    }
    return null;
  } catch {
    return null;
  }
}

export async function signTransaction(xdr: string): Promise<string> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return xdr;

  const walletsKit = await getWalletsKit();
  if (!walletsKit) {
    throw new Error("Wallet signing is only available in the browser.");
  }

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
  return network === STELLAR_NETWORKS.PUBLIC
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
