"use client";

import * as React from "react";
import { TransactionTracker } from "@/components/transaction/transaction-tracker";

export interface Step3ReviewProps {
  reviewItems: Array<{ label: string; value: string | number }>;
  isSubmitting: boolean;
  txStep: string;
}

export function Step3Review({
  reviewItems,
  isSubmitting,
  txStep,
}: Step3ReviewProps) {
  return (
    <section className="space-y-6" aria-labelledby="review-heading">
      <h2 id="review-heading" className="sr-only">Review & Submit</h2>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-zinc-100">
              Review Job Metadata
            </p>
            <p className="mt-1 text-sm text-zinc-400">
              This structured metadata will be pinned to IPFS and referenced by the on-chain job record.
            </p>
          </div>
          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-wider text-emerald-400">
            IPFS Ready
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {reviewItems.map((item) => (
            <div
              key={item.label}
              className="rounded-lg border border-zinc-800/50 bg-zinc-950/50 p-4"
            >
              <p className="text-xs uppercase tracking-wider text-zinc-500">
                {item.label}
              </p>
              <p className="mt-1.5 text-sm text-zinc-200">
                {item.value || "—"}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
          On-Chain Publication
        </h3>
        <p className="text-sm text-zinc-300">
          Posting this job will create an on-chain record on Stellar Soroban. The metadata is already pinned to IPFS.
        </p>
      </div>

      <TransactionTracker />

      {isSubmitting && (
        <div className="flex items-center justify-center gap-2 text-amber-400">
          <svg
            className="h-5 w-5 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="text-sm">
            {txStep === "signing"
              ? "Waiting for wallet signature..."
              : txStep === "building"
              ? "Building transaction..."
              : txStep === "simulating"
              ? "Simulating transaction..."
              : txStep === "submitting"
              ? "Submitting to network..."
              : txStep === "confirming"
              ? "Confirming on-chain..."
              : "Processing..."}
          </span>
        </div>
      )}
    </section>
  );
}
