import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";

// TODO: See docs/ISSUES.md — "Wallet Connection"
let kit: StellarWalletsKit | null = null;

export function getWalletsKit(): StellarWalletsKit {
  if (!kit) {
    kit = new StellarWalletsKit({
      network:
        (process.env.NEXT_PUBLIC_STELLAR_NETWORK as Networks) ??
        Networks.TESTNET,
      selectedWalletId: "freighter",
    });
  }
  return kit;
}

/**
 * Opens the wallet-select modal and returns the connected public key.
 * Resolves once the user selects a wallet and the address is retrieved.
 */
export async function connectWallet(): Promise<string> {
  const kit = getWalletsKit();
  return new Promise((resolve, reject) => {
    kit.openModal({
      onWalletSelected: async (wallet) => {
        try {
          kit.setWallet(wallet.id);
          const { address } = await kit.getAddress();
          resolve(address);
        } catch (e) {
          reject(e);
        }
      },
    });
  });
  if (process.env.NEXT_PUBLIC_E2E === "true") return "GD...CLIENT";
  const walletsKit = getWalletsKit();
  return new Promise<string>((resolve, reject) => {
    walletsKit.openModal({
      onWalletSelected: async () => {
        try {
          walletsKit.closeModal();
          const { address } = await walletsKit.getAddress();
          resolve(address);
        } catch (err) {
          reject(err);
        }
      },
    });
  });
}

export async function getConnectedWalletAddress(): Promise<string | null> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return "GD...CLIENT";
  try {
    const { address } = await getWalletsKit().getAddress();
    return address ?? null;
  } catch {
    return null;
  }
}

/**
 * Signs an XDR transaction string via the connected wallet.
 * Returns the signed XDR string ready for submission to the Soroban RPC.
 */
export async function signTransaction(xdr: string): Promise<string> {
  const kit = getWalletsKit();
  const address = localStorage.getItem("wallet_address");
  if (!address) throw new Error("Wallet not connected");

  const { signedTxXdr } = await kit.signTransaction(xdr, {
    publicKey: address,
  if (process.env.NEXT_PUBLIC_E2E === "true") return xdr;
  const walletsKit = getWalletsKit();
  const networkPassphrase =
    (process.env.NEXT_PUBLIC_STELLAR_NETWORK as Networks) ?? Networks.TESTNET;
  const { signedTxXdr } = await walletsKit.signTransaction(xdr, {
    networkPassphrase,
  });
  return signedTxXdr;
}
