"use client";

import { useMemo, useState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { z } from "zod";
import { api } from "@/lib/api";
import { useSubmitBid } from "@/hooks/use-submit-bid";
import { TransactionTracker } from "@/components/transaction/transaction-tracker";
import { useTxStatusStore } from "@/lib/store/use-tx-status-store";

const submitBidSchema = z.object({
  proposal: z
    .string()
    .trim()
    .min(24, "Proposal must be at least 24 characters.")
    .max(2000, "Proposal must be 2,000 characters or fewer."),
});

interface SubmitBidModalProps {
  jobId: string;
  onChainJobId: bigint;
  disabled?: boolean;
  onSubmitted: () => Promise<void>;
  resolveFreelancerAddress: () => Promise<string>;
}

export function SubmitBidModal({
  jobId,
  onChainJobId,
  disabled = false,
  onSubmitted,
  resolveFreelancerAddress,
}: SubmitBidModalProps) {
  const [open, setOpen] = useState(false);
  const [proposal, setProposal] = useState("");
  const validation = useMemo(
    () => submitBidSchema.safeParse({ proposal }),
    [proposal],
  );

  const { submit, isSubmitting } = useSubmitBid();
  const { step, reset: resetTx } = useTxStatusStore();

  const isContractActive = step !== "idle" && step !== "failed";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = submitBidSchema.safeParse({ proposal });
    if (!parsed.success) {
      return;
    }

    try {
      await submit({
        jobId,
        onChainJobId,
        proposal: parsed.data.proposal,
      });
      setProposal("");
      // Don't close immediately if we want to show success in tracker
      setTimeout(async () => {
        setOpen(false);
        resetTx();
        await onSubmitted();
      }, 5000);
    } catch (err) {
      console.error("Bid submission failed:", err);
    }
  }

  const proposalError =
    proposal.length === 0
      ? ""
      : validation.success
        ? ""
        : validation.error.flatten().fieldErrors.proposal?.[0] ?? "";

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-zinc-950 transition duration-150 hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
      >
        Submit Bid
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/75 p-4 backdrop-blur-sm sm:items-center"
          role="presentation"
          onClick={() => !isSubmitting && !isContractActive && setOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-bid-title"
            aria-describedby="submit-bid-description"
            className="w-full max-w-xl rounded-xl border border-white/15 bg-zinc-900/85 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
                  Open Opportunity
                </p>
                <h3 id="submit-bid-title" className="mt-2 text-2xl font-semibold text-zinc-50">
                  Submit your bid
                </h3>
                <p id="submit-bid-description" className="mt-2 text-sm text-zinc-300">
                  Share your execution plan, delivery confidence, and what makes you the best fit.
                </p>
              </div>
            </div>

            <div className="mt-6">
              {isContractActive || isSubmitting ? (
                <div className="space-y-4">
                  <p className="text-xs font-medium text-zinc-400">
                    Blockchain Transaction Lifecycle
                  </p>
                  <TransactionTracker />
                  {step === "confirmed" && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        resetTx();
                        void onSubmitted();
                      }}
                      className="w-full rounded-xl bg-zinc-800 py-3 text-sm font-semibold text-white hover:bg-zinc-700"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <label htmlFor="bid-proposal" className="block text-sm font-medium text-zinc-100">
                    Proposal
                  </label>
                  <textarea
                    id="bid-proposal"
                    value={proposal}
                    onChange={(event) => setProposal(event.target.value)}
                    className="min-h-[168px] w-full rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-100 outline-none transition duration-150 placeholder:text-zinc-500 hover:border-zinc-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/35"
                    placeholder="Describe your process, delivery checkpoints, and relevant Web3 work."
                    aria-invalid={Boolean(proposalError)}
                    aria-describedby={proposalError ? "bid-proposal-error" : undefined}
                    required
                  />
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>{proposal.trim().length}/2000</span>
                    {proposalError ? (
                      <span
                        id="bid-proposal-error"
                        className="inline-flex items-center gap-1 font-medium text-amber-400"
                      >
                        <AlertCircle className="h-3.5 w-3.5" />
                        {proposalError}
                      </span>
                    ) : (
                      <span className="text-emerald-400">Looks good</span>
                    )}
                  </div>

                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      disabled={isSubmitting}
                      className="rounded-xl border border-zinc-600 px-4 py-2 text-sm font-semibold text-zinc-200 transition duration-150 hover:border-zinc-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-200 active:translate-y-px disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting || !validation.success}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition duration-150 hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmitting ? (
                        <>
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        "Send Bid"
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export { submitBidSchema };
