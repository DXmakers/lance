"use client";

import { AlertTriangle } from "lucide-react";
import { useAuthStore } from "@/lib/store/use-auth-store";

export function NetworkMismatchBanner() {
  const networkMismatch = useAuthStore((state) => state.networkMismatch);

  if (!networkMismatch) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-semibold">Network mismatch — </span>
        your wallet is connected to a different network than this app.
        Please switch your wallet to the correct network to continue.
      </p>
    </div>
  );
}