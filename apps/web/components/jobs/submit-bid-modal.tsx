"use client";

import { useMemo, useState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { z } from "zod";

import { TransactionPipeline } from "@/components/blockchain/transaction-pipeline";
import { useSubmitBid } from "@/hooks/use-submit-bid";

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
}

export function SubmitBidModal({
  jobId,
  onChainJobId,
  disabled = false,
  onSubmitted,
}: SubmitBidModalProps) {
  const [open, setOpen] = useState(false);
  const [proposal, setProposal] = useState("");
  const validation = useMemo(
    () => submitBidSchema.safeParse({ proposal }),
    [proposal],
  );

  const { submit, isSubmitting, transaction } = useSubmitBid();
  const onChainReady = onChainJobId > 0n;
  const showPipeline = transaction.step !== "idle";
  const isPending = isSubmitting || transaction.isPending;

  function closeModal() {
    if (isPending) return;
    setOpen(false);
    transaction.reset();
  }

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
      await onSubmitted();

      window.setTimeout(() => {
        setOpen(false);
        transaction.reset();
      }, 1500);
    } catch (error) {
      console.error("Bid submission failed:", error);
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
          className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/80 p-4 backdrop-blur-sm sm:items-center"
          role="presentation"
          onClick={closeModal}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-bid-title"
            aria-describedby="submit-bid-description"
            className="w-full max-w-2xl rounded-[1.75rem] border border-white/10 bg-zinc-950/95 p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                  Sign → Simulate → Submit
                </p>
                <h3 id="submit-bid-title" className="mt-2 text-2xl font-semibold text-zinc-50">
                  Submit your bid
                </h3>
                <p id="submit-bid-description" className="mt-2 max-w-2xl text-sm text-zinc-300">
                  Prepare the proposal off-chain, inspect the simulated Soroban fee profile, then
                  sign and submit the transaction through your connected wallet.
                </p>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-black/40 px-3 py-2 text-right">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  On-Chain Job
                </p>
                <p className="mt-1 font-mono text-sm text-zinc-100">
                  {onChainReady ? onChainJobId.toString() : "PENDING_INDEXER"}
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-5">
              {!onChainReady && (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
                  The job has not been indexed on-chain yet. Wait for the indexer to assign an
                  on-chain job id before requesting a wallet signature.
                </div>
              )}

              {showPipeline && (
                <TransactionPipeline
                  step={transaction.step}
                  txHash={transaction.txHash}
                  message={transaction.message}
                  error={transaction.error}
                  unsignedXdr={transaction.unsignedXdr}
                  signedXdr={transaction.signedXdr}
                  simulationLog={transaction.simulationLog}
                />
              )}

              {!showPipeline && (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="rounded-2xl border border-zinc-800 bg-black/30 p-4">
                    <div className="mb-3 flex items-center justify-between text-xs text-zinc-500">
                      <span className="font-mono uppercase tracking-[0.18em]">Proposal Payload</span>
                      <span>{proposal.trim().length}/2000</span>
                    </div>

                    <label htmlFor="bid-proposal" className="block text-sm font-medium text-zinc-100">
                      Proposal
                    </label>
                    <textarea
                      id="bid-proposal"
                      value={proposal}
                      onChange={(event) => setProposal(event.target.value)}
                      className="mt-3 min-h-[180px] w-full rounded-2xl border border-zinc-800 bg-zinc-950/90 px-4 py-3 text-sm text-zinc-100 outline-none transition duration-150 placeholder:text-zinc-500 hover:border-zinc-700 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                      placeholder="Describe your milestones, delivery cadence, and contract-safe execution plan."
                      aria-invalid={Boolean(proposalError)}
                      aria-describedby={proposalError ? "bid-proposal-error" : undefined}
                      required
                    />

                    <div className="mt-3 flex items-center justify-between gap-4 text-xs text-zinc-400">
                      {proposalError ? (
                        <span
                          id="bid-proposal-error"
                          className="inline-flex items-center gap-1 font-medium text-amber-400"
                        >
                          <AlertCircle className="h-3.5 w-3.5" />
                          {proposalError}
                        </span>
                      ) : (
                        <span className="text-emerald-400">
                          The wallet simulation step will estimate fees before signature.
                        </span>
                      )}
                      <span className="font-mono text-zinc-500">UTF-8 bytes → Soroban args</span>
                    </div>
                  </div>

                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={closeModal}
                      disabled={isPending}
                      className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 transition duration-150 hover:border-zinc-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-200 active:translate-y-px disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      id="submit-bid"
                      type="submit"
                      disabled={isPending || !validation.success || !onChainReady}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition duration-150 hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmitting ? (
                        <>
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                          Preparing...
                        </>
                      ) : (
                        "Sign & Submit Bid"
                      )}
                    </button>
                  </div>
                </form>
              )}

              {transaction.step === "success" && (
                <button
                  type="button"
                  onClick={closeModal}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 py-3 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
                >
                  Close
                </button>
              )}

              {transaction.step === "error" && (
                <button
                  type="button"
                  onClick={() => transaction.reset()}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 py-3 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
                >
                  Reset Flow
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export { submitBidSchema };
