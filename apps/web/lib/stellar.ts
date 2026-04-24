import { 
  StellarWalletsKit, 
  WalletNetworkChangeHandler, 
  WalletAccountChangeHandler,
  Networks,
  WalletId
} from "@creit.tech/stellar-wallets-kit";

let kit: StellarWalletsKit | null = null;

export function getWalletsKit(): StellarWalletsKit {
  if (typeof window === "undefined") return null as any;
  
  if (!kit) {
    kit = new StellarWalletsKit({
      network: (process.env.NEXT_PUBLIC_STELLAR_NETWORK as Networks) ?? Networks.TESTNET,
      selectedWalletId: WalletId.FREIGHTER,
    });
  }
  return kit;
}

/**
 * Signs a SIWS message to authenticate the user.
 */
export async function signSIWSMessage(address: string, nonce: string): Promise<{ signature: string, message: string }> {
  const domain = window.location.host;
  const message = `${domain} wants you to sign in with your Stellar account:\n${address}\n\nNonce: ${nonce}`;
  
  const walletsKit = getWalletsKit();
  // Most Stellar wallets support signing a blob/text
  const { result } = await walletsKit.sign(message);
  
  return {
    signature: result,
    message
  };
}

/**
 * Signs an XDR transaction string via the connected wallet.
 */
export async function signTransaction(xdr: string): Promise<string> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return xdr;
  
  const walletsKit = getWalletsKit();
  const networkPassphrase = (process.env.NEXT_PUBLIC_STELLAR_NETWORK as Networks) ?? Networks.TESTNET;
  
  const { signedTxXdr } = await walletsKit.signTransaction(xdr, {
    networkPassphrase,
  });
  
  return signedTxXdr;
}

/**
 * Registers listeners for wallet events.
 */
export function registerWalletListeners(
  onAccountChange: WalletAccountChangeHandler,
  onNetworkChange: WalletNetworkChangeHandler
) {
  const walletsKit = getWalletsKit();
  walletsKit.onAccountChange(onAccountChange);
  walletsKit.onNetworkChange(onNetworkChange);
}
