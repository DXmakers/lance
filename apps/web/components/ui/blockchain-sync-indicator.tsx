"use client";

import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";

const SYNCING_STEPS = new Set([
  "building",
  "simulating",
  "signing",
  "submitting",
  "confirming",
]);

export function BlockchainSyncIndicator() {
  const step = useTxStatusStore((state) => state.step);

  if (step === "idle") {
    return null;
  }

  if (SYNCING_STEPS.has(step)) {
    return (
      <div
        className="inline-flex items-center gap-2 rounded-full border border-amber-300/60 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800"
        aria-live="polite"
      >
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        Syncing with blockchain
      </div>
    );
  }

  if (step === "confirmed") {
    return (
      <div
        className="inline-flex items-center gap-2 rounded-full border border-emerald-300/60 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"
        aria-live="polite"
      >
        <CircleCheck className="h-3.5 w-3.5" />
        Synced on-chain
      </div>
    );
  }

  if (step === "failed") {
    return (
      <div
        className="inline-flex items-center gap-2 rounded-full border border-red-300/60 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700"
        aria-live="polite"
      >
        <TriangleAlert className="h-3.5 w-3.5" />
        Sync failed
      </div>
    );
  }

  return null;
}
