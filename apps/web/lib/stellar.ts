import { 
  StellarWalletsKit, 
  WalletNetwork, 
  FREIGHTER_ID,
  ALBEDO_ID,
  XBULL_ID,
} from "@creit.tech/stellar-wallets-kit";

let kit: StellarWalletsKit | null = null;

export const SUPPORTED_WALLETS = [
  FREIGHTER_ID,
  ALBEDO_ID,
  XBULL_ID,
];

export function getWalletsKit(): StellarWalletsKit {
  if (!kit) {
    kit = new StellarWalletsKit({
      network: (process.env.NEXT_PUBLIC_STELLAR_NETWORK as WalletNetwork) ?? WalletNetwork.TESTNET,
      allowHttpProviders: true,
    });
  }
  return kit;
}

function isE2EMode(): boolean {
  return process.env.NEXT_PUBLIC_E2E === "true";
}

function getNetworkPassphrase(network = APP_STELLAR_NETWORK): Networks {
  return network === "public" ? Networks.PUBLIC : Networks.TESTNET;
}

function storeWalletAddress(address: string): void {
  if (!isBrowser()) return;
  localStorage.setItem(WALLET_ADDRESS_STORAGE_KEY, address);
  localStorage.setItem(WALLET_TYPE_STORAGE_KEY, WALLET_KIT_ID);
}

function readStoredWalletAddress(): string | null {
  if (!isBrowser()) return null;
  return localStorage.getItem(WALLET_ADDRESS_STORAGE_KEY);
}

async function initializeWalletsKit(): Promise<void> {
  if (!isBrowser() || isWalletKitInitialized) return;

  const [{ FreighterModule }, { AlbedoModule }, { xBullModule }] =
    await Promise.all([
      import("@creit.tech/stellar-wallets-kit/modules/freighter"),
      import("@creit.tech/stellar-wallets-kit/modules/albedo"),
      import("@creit.tech/stellar-wallets-kit/modules/xbull"),
    ]);

  StellarWalletsKit.init({
    network: getNetworkPassphrase(),
    selectedWalletId: "freighter",
    modules: [new FreighterModule(), new AlbedoModule(), new xBullModule()],
  });
  isWalletKitInitialized = true;
}

export function getWalletsKit(): WalletKit {
  return {
    openModal: async (options) => {
      if (!isBrowser() || isE2EMode()) {
        storeWalletAddress(MOCK_WALLET_ADDRESS);
        await options?.onWalletSelected?.({
          id: WALLET_KIT_ID,
          address: MOCK_WALLET_ADDRESS,
        });
        return { address: MOCK_WALLET_ADDRESS };
      }

      try {
        await initializeWalletsKit();
        const result = await StellarWalletsKit.authModal();
        storeWalletAddress(result.address);
        await options?.onWalletSelected?.({
          id: WALLET_KIT_ID,
          address: result.address,
        });
        return result;
      } catch (error) {
        options?.onClosed?.();
        throw error;
      }
    },

    closeModal: () => {},

    getAddress: async () => {
      if (!isBrowser() || isE2EMode()) {
        return { address: readStoredWalletAddress() ?? MOCK_WALLET_ADDRESS };
      }

      await initializeWalletsKit();
      return StellarWalletsKit.getAddress();
    },

    setNetwork: (network) => {
      StellarWalletsKit.setNetwork(network);
    },

    signTransaction: async (xdr) => {
      if (!isBrowser() || isE2EMode()) return xdr;

      await initializeWalletsKit();
      const result = (await StellarWalletsKit.signTransaction(xdr, {
        networkPassphrase: getNetworkPassphrase(),
      })) as WalletSignTransactionResult;

      return result.signedTxXdr ?? result.signedXDR ?? xdr;
    },

    signMessage: async (message) => {
      if (!isBrowser() || isE2EMode()) return "mock-signature";

      await initializeWalletsKit();
      const result = (await StellarWalletsKit.signMessage(message, {
        networkPassphrase: getNetworkPassphrase(),
      })) as WalletSignMessageResult;

      return result.signedMessage ?? result.signedXDR ?? "";
    },

    disconnect: async () => {
      if (!isBrowser()) return;

      localStorage.removeItem(WALLET_ADDRESS_STORAGE_KEY);
      localStorage.removeItem(WALLET_TYPE_STORAGE_KEY);
      if (isE2EMode()) return;

      await initializeWalletsKit();
      await StellarWalletsKit.disconnect();
    },
  };
}

export async function getConnectedWalletAddress(): Promise<string | null> {
  if (!isBrowser()) return null;

  const stored = readStoredWalletAddress();
  if (isE2EMode()) return stored;

  try {
    return (await getWalletsKit().getAddress()).address;
  } catch {
    return stored;
  }
}

export async function connectWallet(): Promise<string> {
  const { address } = await getWalletsKit().openModal();
  storeWalletAddress(address);
  return address;
}

export function disconnectWallet(): void {
  if (isBrowser()) {
    localStorage.removeItem(WALLET_ADDRESS_STORAGE_KEY);
    localStorage.removeItem(WALLET_TYPE_STORAGE_KEY);
    window.dispatchEvent(new Event("storage"));
  }

  void getWalletsKit().disconnect();
}

export async function signTransaction(xdr: string): Promise<string> {
  if (process.env.NEXT_PUBLIC_E2E === "true") return xdr;
  const walletsKit = getWalletsKit();
  const network = (process.env.NEXT_PUBLIC_STELLAR_NETWORK as WalletNetwork) ?? WalletNetwork.TESTNET;
  const { signedTxXdr } = await walletsKit.signTransaction(xdr, {
    network,
  });
  return signedTxXdr;
}

/**
 * Signs a SIWS message for backend verification.
 */
export async function signAuthMessage(message: string): Promise<string> {
  const walletsKit = getWalletsKit();
  const { signature } = await walletsKit.signAuthMessage(message);
  return signature;
}

export async function disconnectWallet(): Promise<void> {
  // Clear any local state if necessary
}

export async function getNetwork(): Promise<string> {
  const walletsKit = getWalletsKit();
  const { network } = await walletsKit.getNetwork();
  return network;
}
