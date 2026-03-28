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

/** Opens wallet select modal and returns the connected public key. */
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
    }).catch(reject);
  });
}

/** Signs an XDR transaction string via the connected wallet. */
export async function signTransaction(xdr: string): Promise<string> {
  const kit = getWalletsKit();
  const address = localStorage.getItem("wallet_address");
  if (!address) throw new Error("Wallet not connected");

  const { signedXDR } = await kit.sign({
    xdr,
    publicKey: address,
  });
  return signedXDR;
}
