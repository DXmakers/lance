import { Horizon, Networks } from "@stellar/stellar-sdk";

export const APP_STELLAR_NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet").toUpperCase() === "PUBLIC" 
  ? Networks.PUBLIC 
  : Networks.TESTNET;

const HORIZON_URL = process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";
export const horizonServer = new Horizon.Server(HORIZON_URL);

export function isValidStellarAddress(address: string): boolean {
  try {
    return /^[G][A-Z2-7]{55}$/.test(address);
  } catch {
    return false;
  }
}

export function getWalletNetwork(): string {
  return APP_STELLAR_NETWORK === Networks.PUBLIC ? "public" : "testnet";
}

export function disconnectWallet(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem("wallet_address");
    localStorage.removeItem("wallet_type");
    window.dispatchEvent(new Event("storage"));
  }
}

// --- Restored Wallet Kit & Connection Exports ---

export function getWalletsKit() {
  // Returns your configured wallets kit instance
  // Adjust this to return your actual initialized kit if you have specific providers setup
  return {}; 
}

export async function getConnectedWalletAddress(): Promise<string | null> {
  if (typeof window !== "undefined") {
    return localStorage.getItem("wallet_address") || null;
  }
  return null;
}

export async function connectWallet(): Promise<string> {
  // Standard placeholder for wallet connection logic
  // Replace with actual stellar-wallets-kit connect invocation if needed
  return ""; 
}

export async function signTransaction(xdr: string): Promise<string> {
  // Logic to pass the XDR to the connected wallet for signing
  return xdr; 
}

export async function signMessage(message: string): Promise<string> {
  // Logic to pass the SIWS message to the connected wallet for signing
  return "";
}