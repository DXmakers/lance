"use client";

import { type Bid, type Job } from "@/lib/api";
import { formatUsdc, shortenAddress } from "@/lib/format";

interface AcceptBidModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  bid: Bid | null;
  job: Job;
  isPending: boolean;
}

export function AcceptBidModal({
  isOpen,
  onClose,
  onConfirm,
  bid,
  job,
  isPending,
}: AcceptBidModalProps) {
  if (!isOpen || !bid) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/80 p-4 backdrop-blur-sm sm:items-center"
      role="presentation"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="accept-bid-title"
        aria-describedby="accept-bid-description"
        className="w-full max-w-2xl rounded-[1.75rem] border border-white/10 bg-zinc-950/95 p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 id="accept-bid-title" className="text-xl font-semibold text-zinc-50">
              Accept Freelancer Bid
            </h2>
            <p id="accept-bid-description" className="mt-2 text-sm text-zinc-400">
              Review the freelancer&apos;s proposal and accept their bid to start the contract.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isPending}
            className="h-8 w-8 rounded-full bg-zinc-800 text-zinc-400 hover:bg-zinc-700 disabled:opacity-50"
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <div className="rounded-[1.25rem] border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-300">Freelancer</p>
                <p className="mt-1 font-mono text-sm text-zinc-400">
                  {shortenAddress(bid.freelancer_address)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium text-zinc-300">Bid Amount</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">
                  {formatUsdc(job.budget_usdc)}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[1.25rem] border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-sm font-medium text-zinc-300 mb-2">Proposal</p>
            <p className="text-sm text-zinc-400 leading-relaxed">
              {bid.proposal}
            </p>
          </div>

          <div className="rounded-[1.25rem] border border-amber-500/20 bg-amber-950/20 p-4">
            <p className="text-sm font-medium text-amber-300 mb-2">Contract Details</p>
            <div className="space-y-1 text-sm text-amber-200/80">
              <p>• Contract Value: {formatUsdc(job.budget_usdc)}</p>
              <p>• Milestones: {job.milestones}</p>
              <p>• Client: {shortenAddress(job.client_address)}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            disabled={isPending}
            className="flex-1 rounded-[1.25rem] border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1 rounded-[1.25rem] bg-amber-500 px-4 py-3 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? "Accepting..." : "Confirm & Accept"}
          </button>
        </div>
      </section>
    </div>
  );
}