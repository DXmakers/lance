import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";

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
  await kit.openModal({
    onWalletSelected: async (option) => {
      kit.setWallet(option.id);
    },
  });
  const { address } = await kit.getAddress();
  return address;
}

/** Signs an XDR transaction string via the connected wallet. */
export async function signTransaction(xdr: string): Promise<string> {
  const kit = getWalletsKit();
  const { signedXDR } = await kit.signTransaction(xdr);
  return signedXDR;
}
