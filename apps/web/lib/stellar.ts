import {
  Horizon,
  Networks,
  rpc as SorobanRpc,
  TransactionBuilder,
  Contract,
  TimeoutInfinite,
  Account,
  xdr,
  Transaction,
} from "@stellar/stellar-sdk";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";

export type StellarNetwork = "public" | "testnet";

type WalletSelection = {
  id: string;
  address: string;
};

type WalletModalOptions = {
  onWalletSelected?: (option: WalletSelection) => Promise<void> | void;
  onClosed?: () => void;
};

type WalletSignTransactionResult = {
  signedTxXdr?: string;
  signedXDR?: string;
};

type WalletSignMessageResult = {
  signedMessage?: string;
  signedXDR?: string;
};

export type WalletKit = {
  openModal: (options?: WalletModalOptions) => Promise<{ address: string }>;
  closeModal: () => void;
  getAddress: () => Promise<{ address: string }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setNetwork: (network: any) => void;
  signTransaction: (xdr: string) => Promise<string>;
  signMessage: (message: string) => Promise<string>;
  disconnect: () => Promise<void>;
};

const MOCK_WALLET_ADDRESS =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const WALLET_ADDRESS_STORAGE_KEY = "wallet_address";
const WALLET_TYPE_STORAGE_KEY = "wallet_type";
const WALLET_KIT_ID = "stellar-wallets-kit";

export const APP_STELLAR_NETWORK: StellarNetwork =
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet").toLowerCase() ===
  "public"
    ? "public"
    : "testnet";

const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ||
  (APP_STELLAR_NETWORK === "public"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org");

export const horizonServer = new Horizon.Server(HORIZON_URL);

// ──────────────────────────────────────────────────────────────────────────────
// Soroban RPC Simulator and Polling Logic (Issue #164)
// ──────────────────────────────────────────────────────────────────────────────

const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ||
  "https://soroban-testnet.stellar.org";

const NETWORK_PASSPHRASE =
  APP_STELLAR_NETWORK === "public" ? Networks.PUBLIC : Networks.TESTNET;

export const sorobanServer = new SorobanRpc.Server(SOROBAN_RPC_URL);

export async function getAccountState(publicKey: string): Promise<Account> {
  try {
    const accountInfo = await sorobanServer.getAccount(publicKey);
    return new Account(publicKey, accountInfo.sequenceNumber());
  } catch (error) {
    throw new Error(`Failed to fetch account state for ${publicKey}: ${error}`);
  }
}

export interface BuildTransactionParams {
  sourceAddress: string;
  contractId: string;
  method: string;
  args?: xdr.ScVal[];
}

export async function buildAndSimulateTransaction({
  sourceAddress,
  contractId,
  method,
  args = [],
}: BuildTransactionParams): Promise<{
  transaction: Transaction;
  simulation: SorobanRpc.Api.SimulateTransactionResponse;
}> {
  // 1. Fetch fresh account state to avoid Sequence Number Mismatch
  const account = await getAccountState(sourceAddress);
  const contract = new Contract(contractId);

  // 2. Build the base transaction
  const txBuilder = new TransactionBuilder(account, {
    fee: "100", // Base fee; dynamically adjusted by simulation
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  txBuilder.addOperation(contract.call(method, ...args));
  txBuilder.setTimeout(TimeoutInfinite);

  const tx = txBuilder.build();

  // 3. Simulate the transaction
  let simulation: SorobanRpc.Api.SimulateTransactionResponse;
  try {
    simulation = await sorobanServer.simulateTransaction(tx);
  } catch (error) {
    throw new Error(`RPC Simulation request failed: ${error}`);
  }

  // 4. Handle simulation errors
  if (SorobanRpc.Api.isSimulationError(simulation)) {
    if (process.env.NODE_ENV === "development") {
      console.error(
        "Raw Simulation Error:",
        JSON.stringify(simulation, null, 2)
      );
    }
    throw new Error(`Simulation failed: ${simulation.error}`);
  }

  if (process.env.NODE_ENV === "development") {
    console.log("Simulation Success:", JSON.stringify(simulation, null, 2));
    console.log("Raw XDR Before Assembly:", tx.toXDR());
  }

  // 5. Assemble transaction with dynamic resource limits and fees from simulation
  try {
    const assembledTx = SorobanRpc.assembleTransaction(
      tx,
      simulation
    ).build();
    return { transaction: assembledTx as Transaction, simulation };
  } catch (error) {
    throw new Error(
      `Failed to assemble transaction with simulation results: ${error}`
    );
  }
}

export async function submitTransaction(
  signedTx: Transaction
): Promise<SorobanRpc.Api.SendTransactionResponse> {
  const response = await sorobanServer.sendTransaction(signedTx)

  if (response.status === 'ERROR') {
    let isSeqMismatch = false
    try {
      if (response.errorResult) {
        // response.errorResult is already an xdr.TransactionResult object in v12+
        isSeqMismatch =
          response.errorResult.result().switch().name === 'txBadSeq'
      }
    } catch {
      // Ignore parsing errors fallback to generic error
    }

    if (process.env.NODE_ENV === 'development') {
      console.error('Transaction Submit Error:', response.errorResult)
    }

    if (isSeqMismatch) {
      throw new Error('SEQUENCE_MISMATCH')
    }

    throw new Error('Transaction submission failed with network status ERROR.')
  }

  return response
}

export async function pollTransactionStatus(
  txHash: string,
  maxWaitSeconds = 60
): Promise<SorobanRpc.Api.GetTransactionResponse> {
  let waited = 0;
  const pollInterval = 3000;

  while (waited < maxWaitSeconds * 1000) {
    const response = await sorobanServer.getTransaction(txHash);

    if (response.status !== SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
      if (process.env.NODE_ENV === "development") {
        console.log(`Transaction ${txHash} updated to status:`, response.status);
      }
      return response;
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    waited += pollInterval;
  }

  throw new Error(
    `Transaction polling timed out after ${maxWaitSeconds} seconds.`
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Stellar Wallets Kit Integration (from main)
// ──────────────────────────────────────────────────────────────────────────────

let isWalletKitInitialized = false;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function isE2EMode(): boolean {
  return process.env.NEXT_PUBLIC_E2E === "true";
}

function getNetworkPassphrase(network = APP_STELLAR_NETWORK): string {
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

  // Fixed: Forced cast to resolve version mismatch between stellar-sdk and wallets-kit
  StellarWalletsKit.init({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    network: getNetworkPassphrase() as unknown as any,
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
  return getWalletsKit().signTransaction(xdr);
}

export async function signMessage(message: string): Promise<string> {
  return getWalletsKit().signMessage(message);
}

export function isValidStellarAddress(address: string): boolean {
  return /^[G][A-Z2-7]{55}$/.test(address);
}

export function getWalletNetwork(): StellarNetwork {
  return APP_STELLAR_NETWORK;
}

export async function getXlmBalance(address: string): Promise<number> {
  if (!address || isE2EMode()) return 0;

  try {
    const account = await horizonServer.loadAccount(address);
    const native = account.balances.find((b) => b.asset_type === "native");
    return native ? parseFloat(native.balance) : 0;
  } catch (err) {
    console.error("Error fetching XLM balance:", err);
    return 0;
  }
}

// ── Wallet provider identity ──────────────────────────────────────────────────
// These exports support the wallet-provider-icon UI: the connected wallet's
// display name and icon are surfaced alongside the truncated address.

export interface ConnectedWallet {
  address: string;
  walletId: string;
  walletName: string;
  walletIcon: string;
}

/**
 * Opens the wallet-select modal and returns address + provider metadata.
 * Falls back to generic display values when the kit abstraction does not
 * expose per-wallet icons (which is the case for the v2 auth-modal API).
 */
export async function connectWalletWithInfo(): Promise<ConnectedWallet> {
  if (isE2EMode()) {
    storeWalletAddress(MOCK_WALLET_ADDRESS);
    return {
      address: MOCK_WALLET_ADDRESS,
      walletId: "freighter",
      walletName: "Freighter",
      walletIcon: "",
    };
  }

  let capturedId = WALLET_KIT_ID;
  const { address } = await getWalletsKit().openModal({
    onWalletSelected: (option) => {
      capturedId = option.id;
    },
  });

  return {
    address,
    walletId: capturedId,
    walletName: capturedId === WALLET_KIT_ID ? "Stellar Wallet" : capturedId,
    walletIcon: "",
  };
}

/**
 * Returns the wallet provider id previously stored in localStorage, or null
 * if no wallet has been connected in this browser.
 */
export function getSelectedWalletId(): string | null {
  if (!isBrowser()) return null;
  return localStorage.getItem(WALLET_TYPE_STORAGE_KEY);
}

/**
 * Returns minimal provider metadata for the given wallet id.
 * The v2 kit auth-modal abstraction does not expose per-wallet icons, so
 * `icon` is always an empty string; `WalletProviderIcon` renders the
 * lucide fallback in that case.
 */
export async function getWalletInfo(
  walletId: string,
): Promise<{ id: string; name: string; icon: string } | null> {
  if (!walletId) return null;
  return {
    id: walletId,
    name: walletId === WALLET_KIT_ID ? "Stellar Wallet" : walletId,
    icon: "",
  };
}
