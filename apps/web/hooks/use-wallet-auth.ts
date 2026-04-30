"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import {
  connectWallet,
  disconnectWallet,
  getNetworkName,
  signSiwsMessage,
} from "@/lib/stellar";
import { useAuthStore } from "@/lib/store/use-auth-store";

// ── Types ─────────────────────────────────────────────────────────────────────

export type WalletAuthStatus =
  | "idle"
  | "opening-modal"
  | "signing"
  | "verifying"
  | "connected"
  | "error";

export interface NetworkMismatch {
  appNetwork: string;
  walletNetwork: string;
}

export interface UseWalletAuthReturn {
  /** Current Stellar G… address, or null when disconnected. */
  address: string | null;
  /** Whether a wallet session is currently active. */
  isConnected: boolean;
  /** True while any step of the connect flow is in progress. */
  isLoading: boolean;
  /** Granular status string for displaying step-specific UI copy. */
  status: WalletAuthStatus;
  /** Error message from the most recent failed operation. */
  error: string | null;
  /** Non-null when the wallet is on a different network than the app. */
  networkMismatch: NetworkMismatch | null;
  /** Initiate the full SIWS connect flow. */
  connect: () => Promise<void>;
  /** Disconnect and clear all auth state. */
  disconnect: () => Promise<void>;
  /** Clear the current error without disconnecting. */
  clearError: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Detect Freighter's active network by inspecting its API if available. */
async function detectWalletNetwork(): Promise<string | null> {
  try {
    // Freighter exposes a global `freighterApi` in the browser.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const freighter = (window as any).freighterApi;
    if (freighter?.getNetwork) {
      const { network } = await freighter.getNetwork();
      return typeof network === "string" ? network.toLowerCase() : null;
    }
  } catch {
    // Not all wallets expose this API.
  }
  return null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * `useWalletAuth` — full SIWS → JWT authentication flow.
 *
 * Steps on `connect()`:
 *   1. Open wallet modal (user selects wallet + approves)
 *   2. Retrieve Stellar address from wallet
 *   3. Fetch a one-time nonce from `GET /api/v1/auth/nonce`
 *   4. Build and sign the canonical SIWS message
 *   5. Verify signature server-side via `POST /api/v1/auth/verify`
 *   6. Store JWT in Zustand (in-memory only) and update auth state
 */
export function useWalletAuth(): UseWalletAuthReturn {
  const { walletAddress, isLoggedIn, walletLogin, walletLogout } =
    useAuthStore();

  const [status, setStatus] = useState<WalletAuthStatus>(
    isLoggedIn && walletAddress ? "connected" : "idle"
  );
  const [error, setError] = useState<string | null>(null);
  const [networkMismatch, setNetworkMismatch] =
    useState<NetworkMismatch | null>(null);

  const isLoading =
    status === "opening-modal" ||
    status === "signing" ||
    status === "verifying";

  // ── connect ──────────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    setError(null);
    setNetworkMismatch(null);

    try {
      // Step 1 & 2: Open wallet modal, get address.
      setStatus("opening-modal");
      const address = await connectWallet();

      if (!address || !address.startsWith("G") || address.length !== 56) {
        throw new Error(
          `Wallet returned an unexpected address format: "${address}"`
        );
      }

      // Optional: detect network mismatch before signing.
      const walletNet = await detectWalletNetwork();
      const appNet = getNetworkName();
      if (walletNet && walletNet !== appNet) {
        setNetworkMismatch({ appNetwork: appNet, walletNetwork: walletNet });
        // We show the warning but continue — the server will reject if keys
        // don't match the expected network's passphrase.
      }

      // Step 3: Fetch nonce.
      setStatus("signing");
      const { nonce } = await api.auth.nonce(address);

      // Step 4: Build + sign SIWS message.
      const { message, signature } = await signSiwsMessage(address, nonce);

      // Step 5: Verify on backend.
      setStatus("verifying");
      const { token, expires_at } = await api.auth.verify({
        address,
        message,
        signature,
      });

      // Step 6: Persist JWT in-memory + update Zustand.
      // Role defaults to "freelancer"; a subsequent profile fetch (if the
      // backend exposes a /me or role endpoint) should update this.
      const expiresAtMs = new Date(expires_at).getTime();
      walletLogin(address, token, expiresAtMs, "freelancer");
      setStatus("connected");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "An unknown error occurred";

      // Classify user-cancelled modal differently from real errors.
      const isCancelled =
        message.toLowerCase().includes("cancel") ||
        message.toLowerCase().includes("rejected") ||
        message.toLowerCase().includes("denied");

      setError(isCancelled ? null : message);
      setStatus(isCancelled ? "idle" : "error");
    }
  }, [walletLogin]);

  // ── disconnect ───────────────────────────────────────────────────────────

  const disconnect = useCallback(async () => {
    try {
      await disconnectWallet();
    } finally {
      walletLogout();
      setStatus("idle");
      setError(null);
      setNetworkMismatch(null);
    }
  }, [walletLogout]);

  // ── clearError ───────────────────────────────────────────────────────────

  const clearError = useCallback(() => {
    setError(null);
    setStatus("idle");
  }, []);

  return {
    address: walletAddress,
    isConnected: isLoggedIn && !!walletAddress,
    isLoading,
    status,
    error,
    networkMismatch,
    connect,
    disconnect,
    clearError,
  };
}
