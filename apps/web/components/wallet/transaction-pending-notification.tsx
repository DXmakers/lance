"use client";

import { LoaderCircle, TriangleAlert, Unplug } from "lucide-react";
import { useWalletSession } from "@/hooks/use-wallet-session";
import { CopyAddressButton } from "@/components/wallet/copy-address-button";

interface TransactionPendingNotificationProps {
  isPending: boolean;
  pendingText?: string;
  txHash?: string | null;
}

export function TransactionPendingNotification({
  isPending,
  pendingText = "Transaction pending on Stellar. Keep this tab open while confirmation finalizes.",
  txHash,
}: TransactionPendingNotificationProps) {
  const {
    address,
    appNetwork,
    walletNetwork,
    networkMismatch,
    isConnecting,
    isConnected,
    error,
    connect,
    disconnect,
  } = useWalletSession();

  return (
    <section
      aria-label="Wallet connection and transaction pending state"
      className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-zinc-100 shadow-[0_20px_60px_-40px_rgba(79,70,229,0.75)] transition-opacity duration-200"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-[0.16em] text-indigo-300">
            Wallet Session
          </p>
          <p className="text-sm text-zinc-300" aria-live="polite">
            {isConnected && address
              ? "Connected wallet"
              : "No wallet connected"}
          </p>
          {isConnected && address ? <CopyAddressButton address={address} /> : null}
          <p className="text-xs text-zinc-400">App network: {appNetwork}</p>
          {walletNetwork ? (
            <p className="text-xs text-zinc-400">Wallet network: {walletNetwork}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {isConnected ? (
            <button
              type="button"
              onClick={() => void disconnect()}
              aria-label="Disconnect Stellar wallet"
              className="inline-flex items-center gap-1 rounded-xl border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 transition-opacity duration-200 hover:opacity-80"
            >
              <Unplug className="h-3.5 w-3.5" />
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void connect()}
              disabled={isConnecting}
              aria-label="Connect Stellar wallet"
              className="rounded-xl bg-indigo-500 px-3 py-2 text-xs font-semibold text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isConnecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </div>

      {networkMismatch ? (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Network mismatch detected. Your wallet is connected to {walletNetwork},
            but this app is configured for {appNetwork}. Switch wallet network before
            signing.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-100">
          {error}
        </p>
      ) : null}

      {isPending ? (
        <div
          role="status"
          aria-live="polite"
          className="mt-3 flex items-start gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 p-3 text-sm text-indigo-100"
        >
          <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
          <div>
            <p className="font-medium">{pendingText}</p>
            {txHash ? <p className="mt-1 break-all text-xs opacity-80">tx: {txHash}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
