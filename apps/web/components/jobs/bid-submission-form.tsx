"use client";

import { useMemo, useState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";

import { useSubmitBid } from "@/hooks/use-submit-bid";
import { bidSchema } from "@/lib/validations/bid-schema";

interface BidSubmissionFormProps {
  jobId: string;
  onChainJobId: bigint;
  onSubmitted: () => Promise<void>;
  disabled?: boolean;
}

export function BidSubmissionForm({
  jobId,
  onChainJobId,
  onSubmitted,
  disabled = false,
}: BidSubmissionFormProps) {
  const [proposal, setProposal] = useState("");
  const { submit, isSubmitting, transaction } = useSubmitBid();

  const validation = useMemo(
    () => bidSchema.safeParse({ proposal }),
    [proposal],
  );

  const proposalError =
    proposal.length === 0 || validation.success
      ? ""
      : validation.error.flatten().fieldErrors.proposal?.[0] ?? "";

  const onChainReady = onChainJobId > 0n;
  const isPending = isSubmitting || transaction.isPending;
  const isSubmitDisabled = disabled || isPending || !onChainReady || !validation.success;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validation.success) {
      return;
    }

    try {
      await submit({
        jobId,
        onChainJobId,
        proposal: validation.data.proposal,
      });
      setProposal("");
      await onSubmitted();
    } catch (error) {
      console.error("Bid submission failed:", error);
    }
  };

  function handleClear() {
    if (isPending) {
      return;
    }

    setProposal("");
  }

  return (
    <div className="space-y-4">
      {!onChainReady && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
          The job has not been indexed on-chain yet. Wait for the indexer to assign an on-chain job id before
          requesting a wallet signature.
        </div>
      )}

      {transaction.error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          {transaction.error}
        </div>
      ) : null}

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
          onClick={handleClear}
          disabled={isPending}
          className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 transition duration-150 hover:border-zinc-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-200 active:translate-y-px disabled:opacity-50"
        >
          Clear
        </button>
        <button
          type="submit"
          disabled={isSubmitDisabled}
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
  );
}